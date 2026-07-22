import "server-only";

import {
  getApps,
  initializeApp,
} from "firebase-admin/app";

import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      });

export const adminAuth = getAuth(adminApp);
export const adminDb = getDatabase(adminApp);
export const adminMessaging = getMessaging(adminApp);

export { adminApp };