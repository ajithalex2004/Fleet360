export const RIDER_EVENTS = ['trip.cancelled','trip.departed','trip.arriving','trip.delayed','trip.completed','vehicle.changed','driver.changed','boarding.missed'] as const;
export const RIDER_CHANNELS = ['EMAIL','SMS','WHATSAPP'] as const;
export interface RiderRule { event_type: string; enabled: boolean; channels: string[]; subject: string; body: string }
export const defaultRules: RiderRule[] = RIDER_EVENTS.map(event_type => ({ event_type, enabled: false, channels: ['EMAIL'], subject: 'Trip {{tripNumber}} update', body: ({
 'trip.cancelled': 'Your trip {{tripNumber}} has been cancelled. {{reason}}',
 'trip.departed': 'Your trip {{tripNumber}} has departed.',
 'trip.arriving': 'Your bus for trip {{tripNumber}} is approaching {{stopName}} in approximately {{minutesToArrival}} minutes.',
 'trip.delayed': 'Your trip {{tripNumber}} is delayed by approximately {{delayMinutes}} minutes at {{stopName}}.',
 'trip.completed': 'Your trip {{tripNumber}} has completed.',
 'vehicle.changed': 'The assigned vehicle for trip {{tripNumber}} has changed. Please check your trip details.',
 'driver.changed': 'The assigned driver for trip {{tripNumber}} has changed. Please check your trip details.',
 'boarding.missed': 'Your bus for trip {{tripNumber}} has passed {{stopName}} without recording your boarding. Please contact transport operations.',
 } as Record<string,string>)[event_type] }));
