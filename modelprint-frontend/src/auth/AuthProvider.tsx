import { MsalProvider } from "@azure/msal-react";
import {
  PublicClientApplication,
  EventType,
  type AuthenticationResult,
} from "@azure/msal-browser";
import { msalConfig } from "./authConfig";
import { type ReactNode, useEffect, useState } from "react";

// Single MSAL instance shared across the app
export const msalInstance = new PublicClientApplication(msalConfig);

// Initialize and handle redirect at module level.
// In a popup window, handleRedirectPromise() sends the auth code
// back to the parent window and closes the popup.
export const msalReady = msalInstance
  .initialize()
  .then(() => msalInstance.handleRedirectPromise())
  .catch(() => null);

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState(false);

  useEffect(() => {
    msalReady
      .then(() => {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          msalInstance.setActiveAccount(accounts[0]);
        }

        msalInstance.addEventCallback((event) => {
          if (
            event.eventType === EventType.LOGIN_SUCCESS &&
            event.payload
          ) {
            const result = event.payload as AuthenticationResult;
            msalInstance.setActiveAccount(result.account);
          }
        });

        setIsReady(true);
      })
      .catch((err) => {
        console.warn("MSAL initialization failed:", err);
        setInitError(true);
      });
  }, []);

  if (initError) {
    return <>{children}</>;
  }

  if (!isReady) {
    return null;
  }

  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}
