/**
 * src/components/exchange/marketplace/OpportunityCard.tsx
 *
 * Phase 3.4 & Phase 14: Multi-Domain Marketplace Opportunity Card Component.
 * Features common shell with typed domain requirements renderers, staged disclosure,
 * Multi-Emirate Zone Match badges, Preferred Exclusive Window priority indicators,
 * and Quote Revision (Rev N+1) support.
 */

'use client';

import React from 'react';
import {
  Clock,
  MapPin,
  ShieldCheck,
  Send,
  Thermometer,
  Sparkles,
} from 'lucide-react';

interface OpportunityCardProps {
  opportunity: any;
  onQuoteClick: (opp: any) => void;
}

export function OpportunityCard({ opportunity, onQuoteClick }: OpportunityCardProps) {
  const disclosure = opportunity.disclosurePayload || {};
  const domain = opportunity.domain;
  const quotes = opportunity.request?.quotes || [];
  const hasQuoted = quotes.length > 0;
  const latestQuote = hasQuoted ? quotes[0] : null;
  const isPreferredWindowActive = Boolean(opportunity.preferredWindow?.exclusiveWindowActive);
  const emirateMatch = opportunity.emirateMatch !== false;
  const matchedZoneLabel = opportunity.matchedZoneLabel;

  return (
    <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 transition shadow-sm space-y-4 font-sans text-xs">
      {/* Shell Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-cyan-400 font-bold">
            {opportunity.request?.requestNumber || opportunity.id.slice(0, 8)}
          </span>
          <DomainBadge domain={domain} />
        </div>

        <div className="flex items-center gap-1.5 text-slate-400 shrink-0">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span>
            Closes {new Date(opportunity.closesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Phase 14: Multi-Emirate Zone Match & Preferred Exclusive Window Priority Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {emirateMatch ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Zone Match{matchedZoneLabel ? `: ${matchedZoneLabel}` : ''}</span>
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            Out-of-Zone Emirate
          </span>
        )}

        {isPreferredWindowActive ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>
              Preferred Exclusive Window
              {opportunity.preferredWindow?.exclusiveWindowEndsAt
                ? ` (until ${new Date(opportunity.preferredWindow.exclusiveWindowEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
                : ''}
            </span>
          </span>
        ) : opportunity.visibility === 'TENANT_NETWORK' ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            Private Network RFQ
          </span>
        ) : null}
      </div>

      {/* Locations */}
      <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1.5">
        <div className="flex items-center gap-2 text-slate-300">
          <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="font-semibold">{disclosure.pickupZone || 'Pickup Area'}</span>
          <span className="text-slate-500">→</span>
          <span className="font-semibold">{disclosure.dropoffZone || 'Drop-off Area'}</span>
        </div>
        <div className="text-[11px] text-slate-400 flex items-center gap-3">
          <span>Date: {disclosure.serviceDate || 'Scheduled'}</span>
          <span>Time: {disclosure.pickupTime || 'TBD'}</span>
        </div>
      </div>

      {/* Typed Requirements Renderer */}
      <OpportunityRequirementsRenderer domain={domain} payload={disclosure} />

      {/* Footer & Quote CTA */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
        {hasQuoted && latestQuote ? (
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            ✓ Quoted Rev {latestQuote.revisionNo || 1} (AED {Number(latestQuote.totalAmount).toFixed(2)})
          </span>
        ) : (
          <span className="text-slate-400 text-[11px]">Blind bidding active • Zero competitor leak</span>
        )}

        <button
          onClick={() => onQuoteClick(opportunity)}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition flex items-center gap-1.5 active:scale-95"
        >
          <Send className="w-3 h-3" />
          <span>{hasQuoted ? `Revise Quote (Rev ${(latestQuote?.revisionNo || 1) + 1})` : 'Submit Quote'}</span>
        </button>
      </div>
    </div>
  );
}

function DomainBadge({ domain }: { domain: string }) {
  switch (domain) {
    case 'FREIGHT':
      return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">Freight & Cargo</span>;
    case 'RECOVERY':
      return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">Recovery & Towing</span>;
    case 'LIMOUSINE':
      return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">VIP Limousine</span>;
    case 'SCHOOL_TRANSPORT':
      return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">School Transport</span>;
    default:
      return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">Passenger Transport</span>;
  }
}

function OpportunityRequirementsRenderer({ domain, payload }: { domain: string; payload: any }) {
  switch (domain) {
    case 'FREIGHT':
      return (
        <div className="grid grid-cols-2 gap-2 text-[11px] p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/40">
          <div><span className="text-slate-400">Cargo:</span> <span className="text-slate-200 font-semibold">{payload.cargoType}</span></div>
          <div><span className="text-slate-400">Weight:</span> <span className="text-slate-200 font-semibold">{payload.weightKg} kg</span></div>
          <div><span className="text-slate-400">Body:</span> <span className="text-slate-200 font-semibold">{payload.bodyType}</span></div>
          {payload.temperatureControlled && (
            <div className="flex items-center gap-1 text-cyan-400">
              <Thermometer className="w-3 h-3" />
              <span>Cold Chain ({payload.requiredTempCelsius}°C)</span>
            </div>
          )}
        </div>
      );

    case 'RECOVERY':
      return (
        <div className="grid grid-cols-2 gap-2 text-[11px] p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/40">
          <div><span className="text-slate-400">Vehicle:</span> <span className="text-slate-200 font-semibold">{payload.disabledVehicleType}</span></div>
          <div><span className="text-slate-400">Equipment:</span> <span className="text-rose-400 font-semibold">{payload.recoveryType}</span></div>
          <div><span className="text-slate-400">Condition:</span> <span className="text-slate-200 font-semibold">{payload.vehicleCondition}</span></div>
          <div><span className="text-slate-400">Urgency:</span> <span className="text-amber-400 font-semibold">{payload.urgency}</span></div>
        </div>
      );

    case 'LIMOUSINE':
      return (
        <div className="grid grid-cols-2 gap-2 text-[11px] p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/40">
          <div><span className="text-slate-400">Class:</span> <span className="text-purple-300 font-semibold">{payload.luxuryClass}</span></div>
          <div><span className="text-slate-400">Passengers:</span> <span className="text-slate-200 font-semibold">{payload.passengerCount} VIPs</span></div>
          <div><span className="text-slate-400">Luggage:</span> <span className="text-slate-200 font-semibold">{payload.luggageCount} Bags</span></div>
          {payload.meetAndGreet && <div className="text-purple-400 font-semibold">★ Airport Meet & Greet</div>}
        </div>
      );

    default: // PASSENGER_TRANSPORT
      return (
        <div className="grid grid-cols-2 gap-2 text-[11px] p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/40">
          <div><span className="text-slate-400">Capacity:</span> <span className="text-cyan-300 font-semibold">{payload.passengerSeats} Seats</span></div>
          <div><span className="text-slate-400">Class:</span> <span className="text-slate-200 font-semibold">{payload.busClass || 'Staff Bus'}</span></div>
        </div>
      );
  }
}
