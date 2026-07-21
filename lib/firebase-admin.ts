// lib/firebase-admin.ts

import "server-only";

import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

function readRequiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required server environment variable: ${name}`,
    );
  }

  return value;
}

const projectId = readRequiredEnvironment(
  "FIREBASE_ADMIN_PROJECT_ID",
);

const clientEmail = readRequiredEnvironment(
  "FIREBASE_ADMIN_CLIENT_EMAIL",
);

const privateKey = readRequiredEnvironment(
  "FIREBASE_ADMIN_PRIVATE_KEY",
).replace(/\\n/g, "\n");

const databaseURL = readRequiredEnvironment(
  "FIREBASE_ADMIN_DATABASE_URL",
);

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        databaseURL,
      });

export const adminAuth = getAuth(adminApp);
export const adminDb = getDatabase(adminApp);
export const adminMessaging = getMessaging(adminApp);

export { adminApp };