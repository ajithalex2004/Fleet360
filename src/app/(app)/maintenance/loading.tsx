import React from 'react';

const Loading = () => {
    return (
        <div className="flex items-center justify-center h-full w-full bg-slate-950">
            <div className="flex flex-col items-center gap-4">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
                <p className="text-slate-500 font-medium animate-pulse">Loading...</p>
            </div>
        </div>
    );
};

export default Loading;
