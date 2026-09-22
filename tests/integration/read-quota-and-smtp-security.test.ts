import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {createEmailSender} from '../../src/server/auth/email';
import {getEnv} from '../../src/server/env';
const state=vi.hoisted(()=>({id:'review-placeholder'}));
vi.mock('@/server/auth/index',()=>({auth:{api:{getSession:async()=>({user:{id:state.id,name:'review',email:'review@orbit.test',emailVerified:true,timezone:'Asia/Shanghai'}})}}}));
import {requireSessionUser} from '../../src/server/auth/session';
import {prisma} from '../../src/server/db/prisma';
import {bucketHash} from '../../src/server/modules/rate-limit/postgres';
test('production read quota rejects both GET and HEAD',async()=>{
 state.id=randomUUID();const keyHash=bucketHash('read',state.id);const prior=process.env.APP_ENV;
 await prisma.rateLimitBucket.create({data:{keyHash,count:300,windowStart:new Date(),expiresAt:new Date(Date.now()+60000)}});
 try{
  process.env.APP_ENV='production';
  await expect(requireSessionUser(new Request('http://localhost/api/v1/me'))).rejects.toMatchObject({code:'RATE_LIMITED'});
  await expect(requireSessionUser(new Request('http://localhost/api/v1/me',{method:'HEAD'}))).rejects.toMatchObject({code:'RATE_LIMITED'});
 }finally{process.env.APP_ENV=prior;await prisma.rateLimitBucket.deleteMany({where:{keyHash}});await prisma.$disconnect();}
});
test('production SMTP rejects a server without STARTTLS before AUTH',async()=>{
 let authSeen=false;
 const server=createServer(socket=>{
  socket.write('220 review.local ESMTP\r\n');let buf='',dataMode=false;
  socket.on('data',chunk=>{
   buf+=chunk.toString();let pos;
   while((pos=buf.indexOf('\r\n'))>=0){
    const line=buf.slice(0,pos);buf=buf.slice(pos+2);
    if(dataMode){if(line==='.') {dataMode=false;socket.write('250 queued\r\n');}continue;}
    if(line.startsWith('EHLO'))socket.write('250-review.local\r\n250 AUTH PLAIN\r\n');
    else if(line==='STARTTLS')socket.write('502 STARTTLS unavailable\r\n');
    else if(line.startsWith('AUTH')){authSeen=true;socket.write('235 authenticated\r\n');}
    else if(line==='DATA'){dataMode=true;socket.write('354 send data\r\n');}
    else if(line==='QUIT'){socket.end('221 bye\r\n');}
    else socket.write('250 ok\r\n');
   }
  });
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('No port');
 try{
  const sender=createEmailSender({...getEnv(),APP_ENV:'production',SMTP_HOST:'127.0.0.1',SMTP_PORT:address.port,SMTP_SECURE:false,SMTP_USER:'synthetic-user',SMTP_PASSWORD:'synthetic-only',MAIL_FROM:'review@orbit.test'});
  await expect(sender.sendResetPassword({user:{id:'synthetic',email:'review@orbit.test'},token:'synthetic-only',url:'https://example.com'})).rejects.toThrow();
  expect(authSeen).toBe(false);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
