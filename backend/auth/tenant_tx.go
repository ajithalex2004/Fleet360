package auth

import (
	"bytes"
	"net/http"

	"fleet360-backend/database"
	"fleet360-backend/logging"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Request-scoped tenant transaction.
//
// Tables under FORCE ROW LEVEL SECURITY return and accept only the rows of
// the tenant named by the transaction-local setting app.tenant_id. A query
// run on the bare pool (database.DB) has no such setting and sees nothing.
// TenantTx gives each request one transaction, begun on first use, with
// app.tenant_id set to the caller's tenant via set_config(..., true): the
// only form safe behind a transaction-pooling proxy. Handlers use
// TenantDB(c) where they used database.DB.
//
// The response is buffered and sent only after the transaction commits,
// so a client never sees a success whose writes were not committed (it
// gets 500 instead), and a read that follows sees them. An error answer
// (4xx or 5xx) or a panic rolls the transaction back: a request's writes
// land together or not at all.
//
// A statement whose failure a handler tolerates must run through Try: in
// PostgreSQL one failed statement aborts the rest of a transaction.

const ctxTenantTx = "auth.tenant_tx"

// TenantTx is the middleware owning the request transaction; mount it after
// Middleware on routes whose handlers use TenantDB.
func TenantTx() gin.HandlerFunc {
	return tenantTxWith(func() *gorm.DB { return database.DB })
}

func tenantTxWith(pool func() *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		buf := &bufferedWriter{ResponseWriter: c.Writer, body: &bytes.Buffer{}, status: http.StatusOK}
		c.Writer = buf
		c.Set(ctxTenantPool, pool)

		committed := false
		defer func() {
			if r := recover(); r != nil {
				rollback(c)
				// Hand the real writer back so the recovery middleware's 500 is sent.
				c.Writer = buf.ResponseWriter
				panic(r)
			}
			if !committed {
				rollback(c)
			}
		}()

		c.Next()

		tx := current(c)
		if tx != nil {
			if buf.status >= 400 {
				rollback(c)
			} else if err := tx.Commit().Error; err != nil {
				logging.L().Error("tenant transaction commit failed", zap.String("path", c.Request.URL.Path), zap.Error(err))
				c.Set(ctxTenantTx, nil)
				buf.reset(http.StatusInternalServerError, []byte(`{"error":"the change could not be saved"}`))
			}
			c.Set(ctxTenantTx, nil)
		}
		committed = true
		buf.flush()
	}
}

const ctxTenantPool = "auth.tenant_pool"

func current(c *gin.Context) *gorm.DB {
	v, ok := c.Get(ctxTenantTx)
	if !ok || v == nil {
		return nil
	}
	tx, _ := v.(*gorm.DB)
	return tx
}

func rollback(c *gin.Context) {
	if tx := current(c); tx != nil {
		tx.Rollback()
		c.Set(ctxTenantTx, nil)
	}
}

// TenantDB returns the request's tenant transaction, beginning it (with
// app.tenant_id set to the caller's tenant) on first use. Without a tenant
// in the request (TenantTx or Middleware not mounted), it returns a
// session that fails every query rather than an unscoped one.
func TenantDB(c *gin.Context) *gorm.DB {
	if tx := current(c); tx != nil {
		return tx
	}
	tid := TenantID(c)
	poolFn, _ := c.Value(ctxTenantPool).(func() *gorm.DB)
	if tid == "" || poolFn == nil {
		db := database.DB
		if poolFn != nil {
			db = poolFn()
		}
		failed := db.Session(&gorm.Session{NewDB: true})
		_ = failed.AddError(gorm.ErrInvalidTransaction)
		return failed
	}
	tx := poolFn().WithContext(c.Request.Context()).Begin()
	if tx.Error == nil {
		if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, tid).Error; err != nil {
			_ = tx.AddError(err)
		}
	}
	c.Set(ctxTenantTx, tx)
	return tx
}

// Try runs fn in a savepoint of the request transaction: when it fails, the
// savepoint is rolled back and the transaction stays usable.
func Try(c *gin.Context, fn func(tx *gorm.DB) error) error {
	return TenantDB(c).Transaction(fn)
}

// bufferedWriter holds the response until the transaction is settled.
type bufferedWriter struct {
	gin.ResponseWriter
	body    *bytes.Buffer
	status  int
	written bool
}

func (w *bufferedWriter) WriteHeader(code int) { w.status = code; w.written = true }
func (w *bufferedWriter) WriteHeaderNow()      { w.written = true }
func (w *bufferedWriter) Write(b []byte) (int, error) {
	w.written = true
	return w.body.Write(b)
}
func (w *bufferedWriter) WriteString(s string) (int, error) {
	w.written = true
	return w.body.WriteString(s)
}
func (w *bufferedWriter) Status() int   { return w.status }
func (w *bufferedWriter) Size() int     { return w.body.Len() }
func (w *bufferedWriter) Written() bool { return w.written }

func (w *bufferedWriter) reset(status int, body []byte) {
	w.status = status
	w.body.Reset()
	w.body.Write(body)
	w.ResponseWriter.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.ResponseWriter.Header().Del("Content-Length")
}

func (w *bufferedWriter) flush() {
	w.ResponseWriter.WriteHeader(w.status)
	if w.body.Len() > 0 {
		_, _ = w.ResponseWriter.Write(w.body.Bytes())
	}
}
