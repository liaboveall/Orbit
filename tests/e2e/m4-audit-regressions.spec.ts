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

for (const field of ['title', 'description'] as const) {
  test(`task ${field} conflict requires remote comparison before overwriting`, async ({page,request}) => {
    const response = await request.post(`/api/v1/projects/${project.id}/tasks`, {headers:{origin,'Idempotency-Key':randomUUID()},data:{title:'Original audit title'}});
    expect(response.status()).toBe(201);
    const task = SuccessResponseSchema(TaskSchema).parse(await response.json()).data;
    const path = field === 'title' ? `/app/projects/${project.id}/tasks/${task.id}` : `/app/projects/${project.id}/tasks?task=${task.id}`;
    await page.goto(path);
    await page.getByRole('button',{name:field === 'title' ? task.title : '编辑描述',exact:true}).click();
    const input = page.getByRole('textbox',{name:field === 'title' ? '编辑标题' : '编辑描述',exact:true});
    await input.fill('Local audit draft');
    expect((await request.patch(`/api/v1/tasks/${task.id}`,{headers:{origin},data:{expectedVersion:1,[field]:'Remote audit value'}})).status()).toBe(200);
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByRole('button',{name:'载入最新版本并保留草稿',exact:true}).click();
    await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
    await expect(page.getByText('Remote audit value',{exact:true})).toBeVisible();
    await expect(input).toHaveValue('Local audit draft');
    await page.getByRole('button',{name:'保留我的修改并重试',exact:true}).click();
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await expect(input).toHaveCount(0);
    const saved=SuccessResponseSchema(TaskSchema).parse(await(await request.get(`/api/v1/tasks/${task.id}`)).json()).data;
    expect(saved[field]).toBe('Local audit draft');
    expect(saved.version).toBe(3);
  });
}

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

for (const status of [429, 500, 503]) {
test(`invitation preview ${status} preserves token for retry and refresh recovery`,async({page,request})=>{
  const response=await request.post(`/api/v1/projects/${project.id}/invitations`,{headers:{origin,'Idempotency-Key':randomUUID()},data:{}});
  expect(response.status()).toBe(201);
  const body=await response.json();
  const token=body.data.token as string;
  expect(typeof token).toBe('string');
  await page.route('**/api/v1/invitations/preview',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Synthetic temporary outage'},meta:{requestId:'audit-invite-503'}})}));
  await page.goto(`/invite#token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading',{name:'无法加载邀请信息'})).toBeVisible();
  await page.getByRole('button',{name:'重新加载邀请',exact:true}).click();
  await expect(page.getByRole('heading',{name:'无法加载邀请信息'})).toBeVisible();
  await page.unroute('**/api/v1/invitations/preview');
  await page.reload();
  await expect(page.getByRole('heading',{name:'邀请你加入项目'})).toBeVisible();
});
}
