const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-E-1j5rfU1eAMWX-5APMTMCK7C_0muyeV4FdM8JlbHTxKL47lqimoVlyuHdV0vcU4/exec";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {"Access-Control-Allow-Origin": origin || "*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin","Cache-Control":"no-store"};
}
function jsonResponse(data,status,request){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...corsHeaders(request)}})}
async function proxyToAppsScript(request){
  const method=request.method;
  const body=method==="GET"||method==="HEAD"?undefined:await request.arrayBuffer();
  const headers=new Headers();
  const contentType=request.headers.get("Content-Type");
  if(contentType&&method!=="GET"&&method!=="HEAD")headers.set("Content-Type",contentType);
  headers.set("Accept",request.headers.get("Accept")||"application/json");
  const response=await fetch(APPS_SCRIPT_URL,{method,headers,body,redirect:"follow"});
  const text=await response.text();
  if(!text.trim())return jsonResponse({ok:false,error:"O Apps Script respondeu vazio.",status:response.status},502,request);
  try{JSON.parse(text);return jsonResponse(JSON.parse(text),response.status,request)}catch(_){return jsonResponse({ok:false,error:"O Apps Script não retornou JSON válido.",status:response.status,contentType:response.headers.get("content-type")||"",detail:text.replace(/\\s+/g," ").trim().slice(0,800)},502,request)}
}
export async function onRequest(context){if(context.request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(context.request)});try{return await proxyToAppsScript(context.request)}catch(error){return jsonResponse({ok:false,error:"Falha ao conectar ao Apps Script.",detail:String(error&&error.message?error.message:error)},502,context.request)}}
