import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {establishSessionCookies} from '../../tests/ui/auth-setup';
import {cleanupTestEmails, withTestDb} from '../../tests/e2e/support/db';
let emails:string[]=[],pid:string,tid:string;
test.beforeEach(async({request,context,baseURL})=>{
 const meta:{email?:string}={};
 try{await context.addCookies(await establishSessionCookies(request,baseURL!,meta));}finally{if(meta.email)emails.push(meta.email);}
 const headers={origin:baseURL!,'Idempotency-Key':randomUUID()};
 const p=await request.post('/api/v1/projects',{headers,data:{name:'独立审查探针',key:'R'+randomUUID().replaceAll('-','').slice(0,7).toUpperCase()}});
 expect(p.status()).toBe(201);pid=(await p.json()).data.id;
 const t=await request.post(`/api/v1/projects/${pid}/tasks`,{headers:{...headers,'Idempotency-Key':randomUUID()},data:{title:'审查任务'}});
 expect(t.status()).toBe(201);tid=(await t.json()).data.id;
});
test.afterEach(async({page})=>{await page.close();await cleanupTestEmails(emails);emails=[];});
test('composing Enter preserves subtask draft until normal Enter',async({page})=>{
 await page.goto(`/app/projects/${pid}/tasks/${tid}`);
 await page.getByRole('button',{name:'添加子任务',exact:true}).click();
 const input=page.getByRole('textbox',{name:'新子任务标题'});
 await input.fill('尚在输入的中文');
 let posts = 0; page.on('request', r => { if(r.url().endsWith(`/tasks/${tid}/subtasks`) && r.method()==='POST') posts++; });
 await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true});
 await input.dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,bubbles:true,cancelable:true});
 await expect(input).toHaveValue('尚在输入的中文');
 expect(posts).toBe(0);
 const response=page.waitForResponse(r=>r.url().endsWith(`/tasks/${tid}/subtasks`) && r.request().method()==='POST');
 await input.press('Enter');
 expect((await response).status()).toBe(201);
});
test('failed attachment refresh and retry retain selected file',async({page})=>{
 await page.goto(`/app/projects/${pid}/tasks/${tid}`);
 const input=page.getByLabel('选择要上传的文件');
 await input.setInputFiles({name:'review-draft.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic review file')});
 await expect(page.getByText('review-draft.txt',{exact:true})).toBeVisible();
 await page.route(`**/api/v1/tasks/${tid}/attachments`,async route=>{
  if(route.request().method()==='GET')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'review injected transient failure'},meta:{requestId:'review'}})});
  return route.continue();
 });
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('region',{name:'附件'}).getByRole('button',{name:'重新加载'})).toBeVisible();
 await expect(page.getByText('review-draft.txt',{exact:true})).toBeVisible();
 await expect(input).toHaveCount(1);
 await page.unroute(`**/api/v1/tasks/${tid}/attachments`);
 await page.getByRole('region',{name:'附件'}).getByRole('button',{name:'重新加载'}).click();
 await expect(page.getByRole('region',{name:'附件'}).getByRole('button',{name:'重新加载'})).toHaveCount(0);
 await expect(page.getByText('review-draft.txt',{exact:true})).toBeVisible();
});
test('authenticated HEAD returns no body; file content HEAD is unsupported',async({request})=>{
 const response=await request.head(`/api/v1/tasks/${tid}`);
 expect(response.status()).toBe(200);
 expect(response.headers()['content-type']).toContain('application/json');
 expect(await response.body()).toHaveLength(0);
 expect((await request.head(`/api/v1/attachments/${randomUUID()}/content`)).status()).toBe(405);
 expect(response.headers()['referrer-policy']).toBe('no-referrer');
});

for (const kind of ['subtasks', 'comments'] as const) {
 test(`${kind} edit ignores composing Enter and Escape`, async ({page,request,baseURL}) => {
  const comment = kind === 'comments';
  expect((await request.post(`/api/v1/tasks/${tid}/${kind}`, {
   headers: {origin:baseURL!,'Idempotency-Key':randomUUID()},
   data: comment ? {body:'原评论'} : {title:'原子任务'},
  })).status()).toBe(201);
  await page.goto(`/app/projects/${pid}/tasks/${tid}`);
  await page.getByRole('button',{name:comment?'编辑评论':'编辑子任务',exact:true}).click();
  const input=page.getByRole('textbox',{name:comment?'编辑评论内容':'编辑子任务标题',exact:true});
  await input.fill('组合输入草稿');
  for(const key of ['Enter','Escape']) await input.dispatchEvent('keydown',{key,isComposing:true,bubbles:true,cancelable:true});
  await expect(input).toHaveValue('组合输入草稿');
  await input.dispatchEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true});
  await expect(input).toHaveValue('组合输入草稿');
 });
}

test('attachment background failure does not abort an in-flight upload', async ({page}) => {
 await page.goto(`/app/projects/${pid}/tasks/${tid}`);
 await page.getByLabel('选择要上传的文件').setInputFiles({name:'in-flight.txt',mimeType:'text/plain',buffer:Buffer.from('in flight regression')});
 let release!:()=>void, reached!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve;});
 const started=new Promise<void>(resolve=>{reached=resolve;});
 await page.route(`**/api/v1/tasks/${tid}/attachments`,async route=>{
  if(route.request().method()==='POST'){reached();await hold;return route.continue();}
  return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'synthetic'},meta:{requestId:'synthetic'}})});
 });
 try {
  await page.getByRole('button',{name:'上传',exact:true}).click();
  await started;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const region=page.getByRole('region',{name:'附件'});
  await expect(region.getByRole('button',{name:'重新加载'})).toBeVisible();
  await expect(page.getByRole('button',{name:'取消上传',exact:true})).toBeVisible();
  const response=page.waitForResponse(r=>r.url().endsWith(`/tasks/${tid}/attachments`) && r.request().method()==='POST');
  release();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole('button',{name:'取消上传',exact:true})).toHaveCount(0);
 } finally {release();}
});

test('long discussions load only the next page and posting preserves the loaded window',async({page})=>{
 await withTestDb(async db=>{
  const owner=await db.query<{ownerId:string}>('SELECT "ownerId" FROM "Project" WHERE id=$1',[pid]);
  await db.query('INSERT INTO "Comment" (id,"taskId","authorId",body,version,"createdAt","updatedAt") SELECT gen_random_uuid(),$1,$2,\'分页评论\'||n,1,now() + n * interval \'1 millisecond\',now() FROM generate_series(1,95) n',[tid,owner.rows[0]!.ownerId]);
 });
 await page.goto(`/app/projects/${pid}/tasks/${tid}`);
 const region=page.getByRole('region',{name:'评论'});
 await expect(region.getByRole('listitem')).toHaveCount(30);
 const reads:string[]=[];
 page.on('request',r=>{if(r.method()==='GET'&&r.url().includes(`/tasks/${tid}/comments`))reads.push(r.url());});
 await page.getByRole('button',{name:'加载更多评论'}).click();
 await expect(region.getByRole('listitem')).toHaveCount(60);
 expect(reads).toHaveLength(1);
 expect(new URL(reads[0]!).searchParams.has('cursor')).toBe(true);
 // Hold the next page while a focus refresh arrives. Refresh must wait rather
 // than invalidate the click and silently leave the reader at 60 rows.
 let releasePage!:()=>void, pageRequested!:()=>void;
 const held=new Promise<void>(resolve=>{releasePage=resolve;});
 const requested=new Promise<void>(resolve=>{pageRequested=resolve;});
 let intercepted=false;
 await page.route(`**/api/v1/tasks/${tid}/comments?**`,async route=>{
  if(!intercepted && new URL(route.request().url()).searchParams.has('cursor')){
   intercepted=true;const response=await route.fetch();pageRequested();await held;
   await route.fulfill({response});
  }else await route.continue();
 });
 try {
  await page.getByRole('button',{name:'加载更多评论'}).click();
  await requested;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  releasePage();
  await expect(region.getByRole('listitem')).toHaveCount(90);
 }finally {releasePage();await page.unroute(`**/api/v1/tasks/${tid}/comments?**`);}
 await page.getByRole('textbox',{name:'评论正文',exact:true}).fill('刚发布的评论');
 await page.getByRole('button',{name:'发表评论',exact:true}).click();
 await expect(region.getByText('评论已发布到讨论末尾，可继续加载更多评论查看。')).toBeVisible();
 await expect(region.getByRole('listitem')).toHaveCount(90);
 await page.getByRole('button',{name:'加载更多评论'}).click();
 await expect(region.getByText('刚发布的评论',{exact:true})).toBeVisible();
 await expect(region.getByRole('listitem')).toHaveCount(96);
});
