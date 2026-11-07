import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const origin=Deno.env.get('SITE_ORIGIN')||'https://sebastian-ed.github.io';
const h={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const out=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:h});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:h});if(req.method!=='POST')return out({error:'Método inválido'},405);
 const auth=req.headers.get('Authorization')||'';if(!auth.startsWith('Bearer '))return out({error:'No autenticado'},401);
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,token=Deno.env.get('MP_ACCESS_TOKEN');if(!token)return out({error:'Proveedor no configurado'},503);
 const userDb=createClient(url,anon,{global:{headers:{Authorization:auth}}});const db=createClient(url,service);
 const {data:{user}}=await userDb.auth.getUser();if(!user)return out({error:'Iniciá sesión'},401);
 let body:Record<string,unknown>;try{body=await req.json()}catch{return out({error:'JSON inválido'},400)}
 if(body.action!=='cancel'||typeof body.membership_id!=='string')return out({error:'Acción inválida'},400);
 const {data:member,error}=await db.from('memberships').select('id,user_id,mp_preapproval_id,status').eq('id',body.membership_id).maybeSingle();
 if(error||!member)return out({error:'Membresía no encontrada'},404);
 if(member.user_id!==user.id){const {data:p}=await db.from('profiles').select('role').eq('id',user.id).maybeSingle();if(p?.role!=='admin')return out({error:'Sin permisos'},403)}
 if(member.status==='cancelled')return out({ok:true,status:'cancelled'});
 if(!member.mp_preapproval_id)return out({error:'Suscripción aún no confirmada en Mercado Pago. Contactá a administración.'},409);
 try{
  const r=await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(member.mp_preapproval_id)}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({status:'canceled'}),signal:AbortSignal.timeout(15000)});
  const d=await r.json();if(!r.ok){console.error('MP_CANCEL_FAILED',r.status,String(d.message||''));return out({error:'Mercado Pago no confirmó la baja'},502)}
  // Provider status is source of truth. Map 'canceled' spelling to local constraint.
  const cancelled=d.status==='cancelled'||d.status==='canceled';if(!cancelled)return out({error:'Mercado Pago no devolvió estado cancelado. Consultá administración.'},502);
  const {error:save}=await db.from('memberships').update({status:'cancelled',last_provider_update:new Date().toISOString()}).eq('id',member.id);if(save)throw save;
  return out({ok:true,status:'cancelled'});
 }catch(e){console.error('CANCEL_FAILED',e instanceof Error?e.message:'error');return out({error:'No se pudo completar la baja. Consultá administración.'},502)}
});
