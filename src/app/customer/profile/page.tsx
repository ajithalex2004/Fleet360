'use client';

import React, { useState, useEffect } from 'react';

interface UserProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
  memberSince: string;
  totalBookings: number;
  preferredPayment: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/customer/profile');
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <button
          onClick={() => setEditMode(!editMode)}
          className="text-blue-400 text-sm font-medium hover:text-blue-300"
        >
          {editMode ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {profile && (
        <div className="space-y-3">
          {/* Profile Header */}
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center text-3xl">
                👤
              </div>
              <div>
                <h2 className="text-xl font-bold">{profile.name}</h2>
                <p className="text-blue-100 text-sm">Member since {new Date(profile.memberSince).getFullYear()}</p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
              <p className="text-slate-400 text-xs font-medium mb-1">Total Bookings</p>
              <p className="text-2xl font-bold text-white">{profile.totalBookings}</p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
              <p className="text-slate-400 text-xs font-medium mb-1">Preferred Payment</p>
              <p className="text-sm font-bold text-white">{profile.preferredPayment}</p>
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-3">
            <h3 className="text-white font-semibold text-sm">Contact Information</h3>
            <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-slate-400 text-xs font-medium mb-1">Email</p>
                <p className="text-white text-sm">{profile.email}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs font-medium mb-1">Phone</p>
                <p className="text-white text-sm">{profile.phone}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs font-medium mb-1">Address</p>
                <p className="text-white text-sm">{profile.address}</p>
              </div>
            </div>
          </div>

          {/* Settings */}
          <div className="space-y-2">
            <h3 className="text-white font-semibold text-sm">Settings</h3>
            <button className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-left hover:border-blue-500/50 transition-all">
              <p className="text-white font-medium text-sm">Notifications</p>
              <p className="text-slate-400 text-xs">Manage push and email notifications</p>
            </button>
            <button className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-left hover:border-blue-500/50 transition-all">
              <p className="text-white font-medium text-sm">Payment Methods</p>
              <p className="text-slate-400 text-xs">Add or remove payment cards</p>
            </button>
            <button className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-left hover:border-red-500/50 transition-all">
              <p className="text-rose-400 font-medium text-sm">Sign Out</p>
              <p className="text-slate-400 text-xs">Logout from this device</p>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
