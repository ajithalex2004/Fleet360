import Sidebar from '@/components/Maintenance/Sidebar';

export default function MaintenanceLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    console.log('MaintenanceLayout rendering');
    return (
        <div className="flex h-screen w-full overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto p-8 bg-slate-50">
                <div className="mx-auto max-w-7xl">
                    {children}
                </div>
            </main>
        </div>
    );
}
