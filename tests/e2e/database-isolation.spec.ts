import {test, expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {establishSessionCookies} from "../ui/auth-setup";
import {cleanupTestEmails, withTestDb} from "./support/db";
test("runner application writes to the same verified database as its fixtures", async ({request,context,baseURL}) => {
 const meta: {email?: string} = {};
 try {
  await context.addCookies(await establishSessionCookies(request,baseURL!,meta));
  const response = await request.post("/api/v1/projects", {headers:{origin:baseURL!, "Idempotency-Key":randomUUID()},data:{name:"Isolation probe",key:"I"+randomUUID().replaceAll("-","").slice(0,7).toUpperCase()}});
  expect(response.status()).toBe(201);
  const body = await response.json();
  await withTestDb(async client => {
   const result = await client.query('SELECT p.id FROM "Project" p JOIN "User" u ON u.id=p."ownerId" WHERE p.id=$1::uuid AND u.email=$2',[body.data.id,meta.email]);
   expect(result.rowCount).toBe(1);
  });
 } finally {if(meta.email) await cleanupTestEmails([meta.email]);}
});
