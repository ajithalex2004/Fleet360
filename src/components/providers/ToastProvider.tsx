'use client';

import { useState, useCallback } from 'react';
import { ToastContext, Toast as ToastType, ToastType as ToastVariant } from '@/contexts/ToastContext';
import Toast from '@/components/ui/Toast';

export default function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastType[]>([]);

    const addToast = useCallback((message: string, type: ToastVariant = 'info', duration: number = 3000) => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type, duration }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
            {children}
            <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
                {toasts.map((toast) => (
                    <Toast key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}
