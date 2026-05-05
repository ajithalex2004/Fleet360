# @gravity/agent-sdk

**Standalone AI Agent Ecosystem for Fleet Management Platforms**

Plug 7 production-grade AI agents into any fleet platform in minutes — no LLM required for most agents.

## Agents

| Agent | Model | Module | Status |
|-------|-------|--------|--------|
| Predictive Maintenance | Statistical (5-factor) | Fleet | ✅ Live |
| Finance Anomaly Detection | Statistical (5 detectors) | Finance | ✅ Live |
| Route Optimisation | TSP (NN + 2-opt) | School Bus | ✅ Live |
| Incident Auto-Triage | Rules Engine + GPT-4o | Incidents | ✅ Live |
| Smart Dispatch Optimiser | Statistical (15-factor) | Dispatch | ✅ Live |
| Driver Coaching | GPT-4o | Fleet / Driver | ✅ Live |
| Demand Forecasting | Moving Avg + GPT-4o | RAC / Fleet | ✅ Live |

## Quick Start

### Option A — npm package (Node.js / Next.js)

```bash
npm install @gravity/agent-sdk
```

```typescript
import { AgentSDK, UniversalAdapter } from '@gravity/agent-sdk';

const sdk = new AgentSDK({
  baseUrl:      'https://your-gravity-agent-service.com',
  apiKey:       'YOUR_API_KEY',
  tenantId:     'your-org-id',
  openaiApiKey: 'sk-...',   // optional — needed only for LLM agents
});

// Run predictive maintenance scan
const result = await sdk.run('predictive-maintenance');
console.log(result.output.summary);
// "Scored 47 vehicles. 2 CRITICAL, 5 HIGH risk. Auto-created 2 work orders."

// Send an incident event
const adapter = new UniversalAdapter({ tenantId: 'your-org-id' });
await sdk.dispatch(
  adapter.fromIncidentCreated({
    incidentId:      'INC-001',
    type:            'ACCIDENT',
    severity:        'HIGH',
    injuriesReported: true,
  })
);

// Async mode — get callback webhook
const job = await sdk.dispatchAsync({
  agent_id:     'demand-forecasting',
  event_type:   'manual.trigger',
  callback_url: 'https://your-platform.com/webhooks/agent-result',
});
console.log(job.jobId); // poll or wait for webhook
```

### Option B — Docker microservice

```bash
# Copy env file and fill in your values
cp .env.example .env

# Start the agent service
docker compose up -d

# Verify it's running
curl http://localhost:3001/api/agents/catalogue
```

## Platform Adapters

Built-in adapters for common fleet platforms:

```typescript
import { UniversalAdapter } from '@gravity/agent-sdk';
const adapter = new UniversalAdapter({ tenantId: 'your-org' });

// Samsara telematics
const event = adapter.fromSamsara({ vehicleId: 'veh-123', odometerMeters: 50000000 });

// Fleetio service record
const event = adapter.fromFleetioService({ vehicle_id: 'abc', service_type: 'OIL_CHANGE' });

// Geotab fuel transaction
const event = adapter.fromGeotabFuel({ deviceId: 'G9-001', litres: 65.3, pricePer: 2.89 });

// Generic booking / ERP
const event = adapter.fromBookingCreated({ bookingId: 'BK-001', serviceType: 'PASSENGER' });

// Emergency incident
const event = adapter.fromIncidentCreated({ incidentId: 'INC-001', type: 'MEDICAL', severity: 'HIGH' });

// Route updated → re-optimise
const event = adapter.fromRouteUpdated({ routeId: 'RT-001', changeType: 'stop_added' });
```

## Webhook Receiver

```typescript
import { WebhookReceiver } from '@gravity/agent-sdk';
const receiver = new WebhookReceiver({ secret: process.env.AGENT_WEBHOOK_SECRET });

// Express
app.post('/webhooks/agent', express.raw({ type: 'application/json' }), (req, res) => {
  const result = receiver.parse(req.body, req.headers['x-gravity-signature']);
  console.log(result.agentId, result.status, result.output);
  res.json({ received: true });
});

// Next.js App Router
export async function POST(req: Request) {
  const body = await req.text();
  const result = receiver.parse(body, req.headers.get('x-gravity-signature') ?? '');
  return Response.json({ received: true });
}
```

## API Reference

### `AgentSDK`

| Method | Description |
|--------|-------------|
| `sdk.run(agentId)` | Full-scan run, synchronous |
| `sdk.runAll()` | Runs all live agents, returns results map |
| `sdk.dispatch(event)` | Sync single event dispatch |
| `sdk.dispatchAsync(event)` | Async dispatch with webhook callback |
| `sdk.catalogue()` | List all agents and their status |
| `sdk.logs({ agentId, limit })` | Get recent agent run logs |
| `sdk.subscribe({ agentIds, callbackUrl })` | Register a webhook subscription |

## REST API (microservice mode)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/catalogue` | GET | List all agents |
| `/api/agents/run` | POST | Run a specific agent |
| `/api/agents/ingest` | POST | Send an event (sync or async) |
| `/api/agents/logs` | GET | Agent run logs |
| `/api/agents/risk-scores` | GET | Fleet risk scores |
| `/api/agents/anomalies` | GET/PATCH | Finance anomaly flags |
| `/api/agents/route-results` | GET | Route optimisation results |
| `/api/agents/route-results/:id/apply` | POST | Apply / reject optimised route |

## Environment Variables

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
OPENAI_API_KEY=sk-...          # Required for GPT-4o agents
AGENT_API_KEY=your-secret-key  # Protects your agent endpoints
```

## Architecture

```
Your Platform
    │
    ▼ POST /api/agents/ingest
┌─────────────────────────────────┐
│  Universal Adapter Layer        │  Normalises any platform event format
│  Orchestration Bus              │  Routes to correct agent, audit log
│                                 │
│  ┌──────────────┐  ┌─────────┐  │
│  │ Statistical  │  │ GPT-4o  │  │  Zero-cost vs premium agents
│  │  Agents (4)  │  │ Agents  │  │
│  └──────────────┘  └─────────┘  │
│                                 │
│  PostgreSQL  (any hosted DB)    │
└─────────────────────────────────┘
    │
    ▼ Webhook / direct return
Your Platform Dashboard
```

## License

MIT — use in any fleet management platform, commercial or open source.
