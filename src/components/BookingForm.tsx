"use client";

import React, { useState } from "react";

interface BookingFormProps {
    initialOrigin?: string;
    initialDestination?: string;
}

export default function BookingForm({
    initialOrigin = "",
    initialDestination = "",
}: BookingFormProps) {
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitted(true);
        // In a real app, this would submit to an API
    };

    if (submitted) {
        return (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
                <h3 className="font-bold">Booking Request Received</h3>
                <p>We have received your booking request and will process it shortly.</p>
            </div>
        );
    }

    return (
        <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm max-w-md w-full">
            <h2 className="text-lg font-semibold mb-4 text-[#0056b3]">New Booking</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Origin
                    </label>
                    <input
                        type="text"
                        defaultValue={initialOrigin}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-[#0056b3] focus:border-transparent outline-none text-white"
                        placeholder="e.g., Dubai Port"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Destination
                    </label>
                    <input
                        type="text"
                        defaultValue={initialDestination}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-[#0056b3] focus:border-transparent outline-none text-white"
                        placeholder="e.g., London Gateway"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Date
                    </label>
                    <input
                        type="date"
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-[#0056b3] focus:border-transparent outline-none text-white"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Cargo Details
                    </label>
                    <textarea
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-[#0056b3] focus:border-transparent outline-none text-white"
                        rows={3}
                        placeholder="Describe your cargo..."
                        required
                    />
                </div>
                <button
                    type="submit"
                    className="w-full bg-[#0056b3] text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors font-medium"
                >
                    Submit Booking
                </button>
            </form>
        </div>
    );
}
