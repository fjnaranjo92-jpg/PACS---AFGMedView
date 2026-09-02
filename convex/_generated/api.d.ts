/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as admin from "../admin.js";
import type * as adminEmail from "../adminEmail.js";
import type * as aiConfig from "../aiConfig.js";
import type * as aiReport from "../aiReport.js";
import type * as billing from "../billing.js";
import type * as companies from "../companies.js";
import type * as companyAuditLog from "../companyAuditLog.js";
import type * as companyPacs from "../companyPacs.js";
import type * as dicomEquipment from "../dicomEquipment.js";
import type * as dicomGateway from "../dicomGateway.js";
import type * as enterpriseRequests from "../enterpriseRequests.js";
import type * as errorLogs from "../errorLogs.js";
import type * as exportAudit from "../exportAudit.js";
import type * as http from "../http.js";
import type * as licenses from "../licenses.js";
import type * as pacs from "../pacs.js";
import type * as pacsConfig from "../pacsConfig.js";
import type * as pacsDb from "../pacsDb.js";
import type * as permissions from "../permissions.js";
import type * as plans from "../plans.js";
import type * as proAudit from "../proAudit.js";
import type * as settings from "../settings.js";
import type * as shortcuts from "../shortcuts.js";
import type * as studyAssignments from "../studyAssignments.js";
import type * as subscriptions from "../subscriptions.js";
import type * as terms from "../terms.js";
import type * as users from "../users.js";
import type * as viewerPreferences from "../viewerPreferences.js";
import type * as windowPresets from "../windowPresets.js";
import type * as worklist from "../worklist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  admin: typeof admin;
  adminEmail: typeof adminEmail;
  aiConfig: typeof aiConfig;
  aiReport: typeof aiReport;
  billing: typeof billing;
  companies: typeof companies;
  companyAuditLog: typeof companyAuditLog;
  companyPacs: typeof companyPacs;
  dicomEquipment: typeof dicomEquipment;
  dicomGateway: typeof dicomGateway;
  enterpriseRequests: typeof enterpriseRequests;
  errorLogs: typeof errorLogs;
  exportAudit: typeof exportAudit;
  http: typeof http;
  licenses: typeof licenses;
  pacs: typeof pacs;
  pacsConfig: typeof pacsConfig;
  pacsDb: typeof pacsDb;
  permissions: typeof permissions;
  plans: typeof plans;
  proAudit: typeof proAudit;
  settings: typeof settings;
  shortcuts: typeof shortcuts;
  studyAssignments: typeof studyAssignments;
  subscriptions: typeof subscriptions;
  terms: typeof terms;
  users: typeof users;
  viewerPreferences: typeof viewerPreferences;
  windowPresets: typeof windowPresets;
  worklist: typeof worklist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
