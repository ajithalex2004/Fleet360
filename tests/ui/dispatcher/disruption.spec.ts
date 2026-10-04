import { test,expect,type Page } from '@playwright/test';
const browserErrors=new WeakMap<Page,string[]>();
test.beforeEach(({page})=>{const errors:string[]=[];browserErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(({page})=>{expect(browserErrors.get(page)).toEqual([]);});
const base='/api/bus-ops/schedules/synthetic-trip/disruptions';
const recoveryLabel='Validate, assign substitute and queue rider update';
const reported={id:'response-1',status:'REPORTED',version:1,reason:'Synthetic bus engine breakdown',location:'Synthetic depot',reportedAt:'2026-10-04T07:00:00Z',revisedEta:null as string|null,recoveryNotes:null as string|null,resolutionNotes:null as string|null,reportEventId:'report-event',recoveryEventId:null as string|null,resolutionEventId:null as string|null};
async function fixture(page:Page,options:{initial?:'REPORTED'|'RECOVERED';enabled?:boolean;failure?:'conflict'|'validation'|'outage';delay?:boolean;tripStatus?:string;commandError?:string}={}){
 const posts:Array<{url:string;body:Record<string,unknown>}>=[];
 const data={disruptions:(options.initial?[{...reported,status:options.initial,version:options.initial==='RECOVERED'?2:1,revisedEta:options.initial==='RECOVERED'?'2026-10-04T15:30:00Z':null}]:[]) as typeof reported[],
  notificationsEnabled:options.enabled ?? false,deliveries:[] as Array<{event_id:string;status:string;count:number}>,
  vehicles:[{id:'bus-1',licensePlate:'SYNTHETIC-101',plateNumber:null,seatingCapacity:30,status:'ACTIVE'},{id:'bus-2',licensePlate:'SYNTHETIC-102',plateNumber:null,seatingCapacity:40,status:'ACTIVE'}],
  drivers:[{id:'driver-1',name:'Synthetic Driver One',firstName:null,lastName:null},{id:'driver-2',name:'Synthetic Driver Two',firstName:null,lastName:null}]};
 const trip={id:'synthetic-trip',tripNumber:'SYNTHETIC-TRIP',tenantId:'synthetic-tenant',routeId:'synthetic-route',route:{id:'synthetic-route',name:'Synthetic route',origin:'Synthetic origin',destination:'Synthetic destination',totalDistanceKm:10,estimatedDurationMins:30,stops:[]},vehicleId:'bus-1',driverId:'driver-1',departureTime:'2026-10-04T07:00:00Z',arrivalTime:'2026-10-04T15:30:00Z',shiftType:'MORNING',direction:'INBOUND',capacity:30,confirmedCount:0,status:options.tripStatus ?? 'STARTED',notes:null,passengers:[],tripLogs:[]};
 const tripPosts:Array<{url:string;method:string;body:unknown}>=[];
 let release:(()=>void)|undefined;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='http://127.0.0.1:4173')return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(url.pathname==='/api/bus-ops/routes')return route.fulfill({json:[trip.route]});
  if(url.pathname==='/api/bus-ops/drivers')return route.fulfill({json:data.drivers});
  if(url.pathname==='/api/vehicles')return route.fulfill({json:data.vehicles});
  if(url.pathname==='/api/bus-ops/schedules')return route.fulfill({json:[trip]});
  if(url.pathname==='/api/bus-ops/schedules/synthetic-trip' && route.request().method()==='GET')return route.fulfill({json:trip});
  if(url.pathname.match(/\/(depart|en-route|complete|cancel)$/)){
   tripPosts.push({url:url.pathname,method:route.request().method(),body:route.request().postDataJSON()});
   if(options.commandError)return route.fulfill({status:412,json:{error:options.commandError}});
   trip.status=url.pathname.endsWith('/en-route')?'EN_ROUTE':url.pathname.endsWith('/depart')?'STARTED':url.pathname.endsWith('/complete')?'COMPLETED':'CANCELLED';
   return route.fulfill({json:trip});
  }
  if(!url.pathname.startsWith(base))return route.fulfill({status:404,json:{error:'Unexpected test endpoint'}});
  if(route.request().method()==='GET')return route.fulfill({json:data});
  const body=route.request().postDataJSON();posts.push({url:url.pathname,body});
  if(options.delay)await new Promise<void>(resolve=>{release=resolve;});
  if(options.failure==='validation')return route.fulfill({status:409,json:{error:'Substitute assignment blocked',validation:{checks:[{severity:'BLOCK',title:'Vehicle already assigned to an overlapping trip'}]}}});
  if(options.failure==='conflict'){data.disruptions[0]={...reported,version:2};return route.fulfill({status:409,json:{error:'Disruption changed; refresh before continuing'}});}
  if(options.failure==='outage')return route.fulfill({status:503,json:{error:'Authorization authority unavailable'}});
  if(!body.action){data.disruptions.push({...reported});return route.fulfill({status:201,json:data.disruptions[0]});}
  if(body.action==='recover'){Object.assign(data.disruptions[0],{status:'RECOVERED',version:2,revisedEta:body.revisedEta,recoveryNotes:body.notes,recoveryEventId:'recovery-event'});data.deliveries.push({event_id:'recovery-event',status:'SENT',count:2});}
  if(body.action==='resolve')Object.assign(data.disruptions[0],{status:'RESOLVED',version:3,resolutionNotes:body.notes,resolutionEventId:'resolve-event'});
  return route.fulfill({json:data.disruptions[0]});
 });
 return {data,trip,tripPosts,posts,release:()=>release?.()};
}
async function fillRecovery(page:Page){
 await page.getByLabel('Substitute bus').selectOption('bus-1');
 await page.getByRole('combobox',{name:/^Driver/}).selectOption('driver-1');
 await page.getByLabel('Revised destination arrival (your local time)').fill('2026-10-04T19:30');
 await page.getByLabel('Recovery notes').fill('Synthetic substitute inspected and riders transferred');
 for(const box of await page.getByRole('checkbox').all())await box.check();
}
test('dispatcher can report, recover and close with correctly scoped request payloads',async({page})=>{
 const f=await fixture(page,{enabled:true});await page.goto('/');
 await expect(page.getByRole('heading',{name:'Disruption response'})).toBeVisible();
 await page.getByLabel('Breakdown details').fill('Synthetic bus engine breakdown');await page.getByLabel('Location',{exact:true}).fill('Synthetic depot');
 await page.getByRole('button',{name:'Report disruption'}).click();
 await expect(page.getByText('REPORTED: Synthetic bus engine breakdown')).toBeVisible();
 await expect(page.getByRole('button',{name:recoveryLabel})).toBeDisabled();
 await fillRecovery(page);await page.getByRole('button',{name:recoveryLabel}).click();
 await expect(page.getByText('RECOVERED: Synthetic bus engine breakdown')).toBeVisible();
 await expect(page.getByText('SENT: 2')).toBeVisible();
 await page.getByLabel('Confirm service resumed or record final outcome').fill('Synthetic passengers transferred and service resumed');
 await page.getByRole('button',{name:'Confirm response complete'}).click();
 await expect(page.getByRole('cell',{name:'RESOLVED',exact:false})).toBeVisible();
 expect(f.posts).toHaveLength(3);expect(f.posts[0].body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
 expect(f.posts[1].body).toMatchObject({action:'recover',expectedVersion:1,vehicleId:'bus-1',driverId:'driver-1',revisedEta:'2026-10-04T15:30:00.000Z'});
 expect(f.posts[1].body.items).toHaveLength(10);expect(f.posts[2].body).toMatchObject({action:'resolve',expectedVersion:2});
 for(const request of f.posts){expect(request.url).toMatch(/^\/api\/bus-ops\/schedules\/synthetic-trip\/disruptions/);expect(request.body).not.toHaveProperty('tenantId');expect(request.body).not.toHaveProperty('reportedBy');}
 await expect(page.locator('body')).toHaveAttribute('data-refresh-count','3');
});
test('substitute changes invalidate previous inspection confirmations',async({page})=>{
 await fixture(page,{initial:'REPORTED'});await page.goto('/');await fillRecovery(page);
 await expect(page.getByRole('button',{name:recoveryLabel})).toBeEnabled();
 await page.getByLabel('Substitute bus').selectOption('bus-2');
 await expect(page.getByRole('checkbox').first()).not.toBeChecked();await expect(page.getByRole('button',{name:recoveryLabel})).toBeDisabled();
 for(const box of await page.getByRole('checkbox').all())await box.check();
 await page.getByRole('combobox',{name:/^Driver/}).selectOption('driver-2');
 await expect(page.getByRole('checkbox').first()).not.toBeChecked();await expect(page.getByRole('button',{name:recoveryLabel})).toBeDisabled();
});
test('blocked assignment shows actionable validation and retains operator input',async({page})=>{
 const f=await fixture(page,{initial:'REPORTED',failure:'validation'});await page.goto('/');await fillRecovery(page);await page.getByRole('button',{name:recoveryLabel}).click();
 await expect(page.getByRole('alert')).toContainText('Vehicle already assigned');await expect(page.getByLabel('Recovery notes')).toHaveValue('Synthetic substitute inspected and riders transferred');expect(f.posts).toHaveLength(1);
 await expect(page.getByText('REPORTED: Synthetic bus engine breakdown')).toBeVisible();
});
test('stale version refreshes history without claiming recovery succeeded',async({page})=>{
 const f=await fixture(page,{initial:'REPORTED',failure:'conflict'});await page.goto('/');await fillRecovery(page);await page.getByRole('button',{name:recoveryLabel}).click();
 await expect(page.getByRole('alert')).toContainText('refresh before continuing');await expect(page.getByText('REPORTED: Synthetic bus engine breakdown')).toBeVisible();expect(f.posts[0].body.expectedVersion).toBe(1);
});
test('outage keeps a stable report key so retry does not duplicate the report',async({page})=>{
 const f=await fixture(page,{failure:'outage'});await page.goto('/');await page.getByLabel('Breakdown details').fill('Synthetic engine failure');
 await page.getByRole('button',{name:'Report disruption'}).click();await expect(page.getByRole('alert')).toContainText('Authorization authority unavailable');
 await page.getByRole('button',{name:'Report disruption'}).click();await expect.poll(()=>f.posts.length).toBe(2);expect(f.posts[0].body.requestKey).toBe(f.posts[1].body.requestKey);
});
test('pending submission disables its command and does not send a duplicate',async({page})=>{
 const f=await fixture(page,{delay:true});await page.goto('/');await page.getByLabel('Breakdown details').fill('Synthetic engine failure');await page.getByRole('button',{name:'Report disruption'}).click();
 await expect.poll(()=>f.posts.length).toBe(1);await expect(page.getByRole('button',{name:'Report disruption'})).toBeDisabled();f.release();await expect(page.getByText('REPORTED: Synthetic bus engine breakdown')).toBeVisible();expect(f.posts).toHaveLength(1);
});
test('cancelled trip permits closure but offers no new report or substitute command',async({page})=>{
 await fixture(page,{initial:'REPORTED'});await page.goto('/?status=CANCELLED');await expect(page.getByRole('button',{name:'Confirm response complete'})).toBeVisible();
 await expect(page.getByRole('button',{name:recoveryLabel})).toHaveCount(0);await expect(page.getByRole('button',{name:'Report disruption'})).toHaveCount(0);
});
test('completed trip has history only and clearly identifies disabled rider updates',async({page})=>{
 await fixture(page);await page.goto('/?status=COMPLETED');await expect(page.getByText(/Rider updates: disabled/)).toBeVisible();await expect(page.getByRole('button',{name:'Report disruption'})).toHaveCount(0);
});
for(const theme of ['light','dark'])for(const mobile of [false,true])test(`${theme} ${mobile?'mobile':'desktop'} recovery layout has readable controls and no page overflow`,async({page},testInfo)=>{
 await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});await fixture(page,{initial:'REPORTED'});await page.goto(`/?theme=${theme}`);
 await expect(page.getByRole('heading',{name:'Disruption response'})).toBeVisible();await expect(page.getByLabel('Substitute bus')).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(10);
 const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,bg:getComputedStyle(document.querySelector('section')!).backgroundColor,color:getComputedStyle(document.querySelector('section')!).color}));
 expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);expect(layout.bg).not.toBe(layout.color);
 await page.screenshot({path:testInfo.outputPath(`${theme}-${mobile?'mobile':'desktop'}.png`),fullPage:true});
});

test('Trip Monitor details link opens the real trip detail recovery panel',async({page})=>{
 await fixture(page,{initial:'REPORTED'});await page.goto('/bus-ops/dispatch');
 await expect(page.getByRole('heading',{name:'Trip Monitor'})).toBeVisible();
 const details=page.getByRole('link',{name:'Details & recovery'});await expect(details).toHaveAttribute('href','/bus-ops/trips/synthetic-trip');await details.click();
 await expect(page.getByRole('heading',{name:'Trip SYNTHETIC-TRIP'})).toBeVisible();await expect(page.getByRole('heading',{name:'Disruption response'})).toBeVisible();await expect(page.getByText('REPORTED: Synthetic bus engine breakdown')).toBeVisible();
});
test('Trip Monitor moves a started trip through the dedicated en-route command',async({page})=>{
 const f=await fixture(page);await page.goto('/bus-ops/dispatch');await page.getByRole('button',{name:/En Route/}).click();
 await expect.poll(()=>f.tripPosts.length).toBe(1);expect(f.tripPosts[0]).toEqual({url:'/api/bus-ops/schedules/synthetic-trip/en-route',method:'POST',body:{}});
 await expect(page.getByRole('button',{name:/Complete/})).toBeVisible();
});
test('Trip Monitor displays a blocked departure and keeps the trip scheduled',async({page})=>{
 const f=await fixture(page,{tripStatus:'SCHEDULED',commandError:'Resolve the reported disruption with an inspected substitute before departure'});await page.goto('/bus-ops/dispatch');await page.getByRole('button',{name:/Start$/,exact:false}).click();
 await expect(page.getByRole('alert')).toContainText('inspected substitute');expect(f.trip.status).toBe('SCHEDULED');expect(f.tripPosts[0].url).toBe('/api/bus-ops/schedules/synthetic-trip/depart');
});
