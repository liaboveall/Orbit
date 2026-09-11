import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {establishSessionCookies} from '../ui/auth-setup';
import {cleanupTestEmails} from './support/db';
import {ProjectSchema,TaskSchema,SuccessResponseSchema,type ProjectDTO} from '../../src/contracts';
let email='';
let project:ProjectDTO;
const origin=process.env.E2E_AUTH_ORIGIN!;
test.beforeEach(async({request,context,baseURL})=>{
  const meta:{email?:string}={};
  try {await context.addCookies(await establishSessionCookies(request,baseURL!,meta));}
  finally {email=meta.email??'';}
  const response=await request.post('/api/v1/projects',{headers:{origin,'Idempotency-Key':randomUUID()},data:{name:'Independent audit fixture',key:'A'+randomUUID().replaceAll('-','').slice(0,7).toUpperCase()}});
  expect(response.status()).toBe(201);
  project=SuccessResponseSchema(ProjectSchema).parse(await response.json()).data;
});
test.afterEach(async()=>{if(email)await cleanupTestEmails([email]);email='';});

test('owner can read the invitation list over the documented GET API',async({request})=>{
  const response=await request.get(`/api/v1/projects/${project.id}/invitations`);
  console.log(JSON.stringify({probe:'invitation-list-api',status:response.status()}));
  expect(response.status()).toBe(200);
});

test('task conflict recovery must expose the remote edited field before overwriting',async({page,request},info)=>{
  const response=await request.post(`/api/v1/projects/${project.id}/tasks`,{headers:{origin,'Idempotency-Key':randomUUID()},data:{title:'Original audit title'}});
  expect(response.status()).toBe(201);
  const task=SuccessResponseSchema(TaskSchema).parse(await response.json()).data;
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  await page.getByRole('button',{name:task.title,exact:true}).click();
  await page.getByRole('textbox',{name:'编辑标题',exact:true}).fill('Local audit draft');
  expect((await request.patch(`/api/v1/tasks/${task.id}`,{headers:{origin},data:{expectedVersion:1,title:'Remote unseen audit title'}})).status()).toBe(200);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'载入最新版本并保留草稿',exact:true}).click();
  await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
  const remoteVisible=await page.getByText('Remote unseen audit title',{exact:true}).isVisible();
  await page.screenshot({path:info.outputPath('task-conflict-before-overwrite.png'),fullPage:true});
  expect(remoteVisible).toBe(true);
  await page.getByRole('button',{name:'保留我的修改并重试',exact:true}).click();
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'编辑标题',exact:true})).toHaveCount(0);
  const saved=SuccessResponseSchema(TaskSchema).parse(await(await request.get(`/api/v1/tasks/${task.id}`)).json()).data;
  console.log(JSON.stringify({probe:'task-conflict',remoteVisible,savedTitle:saved.title,savedVersion:saved.version}));
  expect(remoteVisible,'Remote same-field value must be displayed for comparison').toBe(true);
});

test('real task panel Escape dismisses only the unsaved-changes dialog',async({page,request})=>{
  const response=await request.post(`/api/v1/projects/${project.id}/tasks`,{headers:{origin,'Idempotency-Key':randomUUID()},data:{title:'Escape audit title'}});
  const task=SuccessResponseSchema(TaskSchema).parse(await response.json()).data;
  await page.goto(`/app/projects/${project.id}/tasks?task=${task.id}`);
  await page.getByRole('button',{name:task.title,exact:true}).click();
  const input=page.getByRole('textbox',{name:'编辑标题',exact:true});
  await input.fill('Unsaved audit title');
  await page.getByRole('button',{name:'关闭详情',exact:true}).click();
  await expect(page.getByRole('button',{name:'保留编辑',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading',{name:'你有未保存的更改',exact:true})).toHaveCount(0);
  await expect(input).toHaveValue('Unsaved audit title');
  await expect(page).toHaveURL(/task=/);
});

test('temporary invitation preview failure preserves token for refresh recovery',async({page,request})=>{
  const response=await request.post(`/api/v1/projects/${project.id}/invitations`,{headers:{origin,'Idempotency-Key':randomUUID()},data:{}});
  expect(response.status()).toBe(201);
  const body=await response.json();
  const token=body.data.token as string;
  expect(typeof token).toBe('string');
  await page.route('**/api/v1/invitations/preview',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Synthetic temporary outage'},meta:{requestId:'audit-invite-503'}})}));
  await page.goto(`/invite#token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading',{name:'无法加载邀请信息'})).toBeVisible();
  await page.unroute('**/api/v1/invitations/preview');
  await page.reload();
  await expect(page.getByRole('heading',{name:'邀请你加入项目'})).toBeVisible();
});
