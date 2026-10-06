import {test,expect,type Page} from '@playwright/test';
const iso=()=>new Date().toISOString();
const trip={id:'trip-one',tripNumber:'BUS-1',departureTime:new Date(Date.now()-3600000).toISOString(),arrivalTime:new Date(Date.now()+1800000).toISOString(),shiftType:'MORNING',direction:'INBOUND',status:'EN_ROUTE',vehicleId:'bus-one',route:{name:'Synthetic route',origin:'Camp',destination:'Office'},bleBeaconUuid:null};
const today={staff:{id:'staff-one',name:'Synthetic Rider',employeeId:'E-1',department:'Operations',defaultStopName:'Camp'},trips:[{passengerId:'passenger-one',status:'CONFIRMED',boardedAt:null,boardingStop:'Camp',alightingStop:'Office',trip}],rfidTag:null};
const journey=(changes:Record<string,unknown>={})=>({asOf:iso(),passengerStatus:'CONFIRMED',tripStatus:'EN_ROUTE',phase:'pickup',target:{id:'pickup',name:'Camp'},plannedAt:new Date(Date.now()+600000).toISOString(),revisedDestinationArrivalAt:null,occupancy:{onboard:12,reserved:22,capacity:30,seatsNotOccupied:18,overCapacity:false,source:'attendance'},state:'live',reason:'Observed GPS',etaAt:new Date(Date.now()+180000).toISOString(),lastGpsAt:iso(),confidence:'high',method:'observed-speed',...changes});
async function fixture(page:Page,data:Record<string,unknown>){
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let reads=0;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:4173')return route.abort();
  if(url.pathname==='/api/bus-ops/passenger/today')return route.fulfill({json:today,headers:{'Cache-Control':'private, no-store'}});
  if(url.pathname==='/api/bus-ops/passenger/journeys/passenger-one'){reads++;return route.fulfill({json:{...data,asOf:iso()}});}
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:[]});
  return route.continue();
 });
 return {reads:()=>reads,errors};
}
test('passenger home shows live pickup ETA and aggregate occupancy',async({page})=>{
 const f=await fixture(page,journey());await page.goto('/bus-ops/passenger');
 await expect(page.getByRole('heading',{name:'Journey status'})).toBeVisible();
 await expect(page.getByText(/Pickup: Camp/)).toBeVisible();
 await expect(page.getByText(/Live estimate:/)).toBeVisible();
 await expect(page.getByText('12 / 30 recorded aboard · 22 reserved')).toBeVisible();
 await expect(page.getByRole('link',{name:/Board/})).toHaveCSS('color','rgb(255, 255, 255)');
 expect(f.reads()).toBeGreaterThan(0);expect(f.errors).toEqual([]);
});
test('stale GPS and disruptions never masquerade as approaching',async({page})=>{
 const f=await fixture(page,journey({state:'gps-stale',etaAt:null,lastGpsAt:new Date(Date.now()-240000).toISOString(),reason:'Location is out of date; live ETA is paused'}));await page.goto('/bus-ops/passenger');
 await expect(page.getByText('Location is out of date; live ETA is paused')).toBeVisible();await expect(page.getByText(/Live estimate:/)).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('mobile rider app uses current journey rather than a session-cached trip ETA',async({page})=>{
 const f=await fixture(page,journey({passengerStatus:'BOARDED',phase:'dropoff',target:{id:'drop',name:'Office'},occupancy:{onboard:13,reserved:22,capacity:30,seatsNotOccupied:17,overCapacity:false,source:'attendance'}}));await page.goto('/bus-ops/passenger/app');
 await expect(page.getByText('Active and upcoming today')).toBeVisible();
 await expect(page.getByText('Drop-off: Office')).toBeVisible();await expect(page.getByText('13 / 30 recorded aboard · 22 reserved')).toBeVisible();expect(f.errors).toEqual([]);
});
for(const theme of ['light','dark'])for(const screen of ['mobile','desktop'])test(`${theme} ${screen} passenger journey layout`,async({page},testInfo)=>{
 await page.setViewportSize(screen==='mobile'?{width:390,height:844}:{width:1440,height:1000});await fixture(page,journey({state:'disrupted',etaAt:null,reason:'Awaiting an inspected substitute bus and driver',revisedDestinationArrivalAt:new Date(Date.now()+3600000).toISOString()}));await page.goto(`/bus-ops/passenger?theme=${theme}`);
 await expect(page.getByText('Awaiting an inspected substitute bus and driver')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:testInfo.outputPath(`${theme}-${screen}-journey.png`),fullPage:true});
});
