"use client";

import { C1Chat } from "@thesysai/genui-sdk";
import React from "react";

export default function ChatInterface() {
    return (
        <div className="flex flex-col h-screen w-full bg-white">
            <div className="flex-1 overflow-hidden">
                <C1Chat
                    apiUrl="/api/chat"
                    theme={{
                        mode: "light",
                    }}
                />
            </div>
        </div>
    );
}
