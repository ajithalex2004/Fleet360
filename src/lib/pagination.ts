/**
 * Shared pagination utility for API routes.
 * Usage:  const { take, skip, page } = paginate(req.nextUrl.searchParams);
 */
export function paginate(params: URLSearchParams, defaultLimit = 50) {
  const page  = Math.max(1, parseInt(params.get('page')  ?? '1',  10));
  const limit = Math.min(200, Math.max(1, parseInt(params.get('limit') ?? String(defaultLimit), 10)));
  return { take: limit, skip: (page - 1) * limit, page, limit };
}

/** Wrap a paginated result with metadata */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
) {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  };
}
