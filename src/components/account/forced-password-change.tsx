"use client";

import { useApiQuery } from "@/services/client/query";
import type { AccountDto } from "@/services/client/types";
import { signOutAction } from "@/app/actions/auth";
import { Blueprint } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/states";
import { PasswordChangeForm } from "./account-view";

/**
 * Shown instead of the application while an administrator-set password is
 * pending a change (the server also refuses every other API with 403
 * PASSWORD_CHANGE_REQUIRED, so this is not the only barrier).
 */
export function ForcedPasswordChange({ email }: { email: string }) {
  const account = useApiQuery<{ account: AccountDto }>("/api/account");
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <Blueprint className="flex w-[min(460px,100%)] flex-col gap-4 px-7 py-8">
        <div>
          <h1 className="m-0 text-[28px]">Choose your own password</h1>
          <p className="text-muted mt-1 mb-0 text-[13.5px]">
            An administrator set the password for {email}. Replace it with one only you know before continuing.
          </p>
        </div>
        {account.data ? (
          <PasswordChangeForm mfaEnabled={account.data.account.mfa.enabled} email={email} submitLabel="Save and continue" onDone={() => window.location.assign(new URL("/dashboard", window.location.origin).href)} />
        ) : (
          <SkeletonRows />
        )}
        <Button variant="ghost" className="self-start text-[13px]" onClick={() => void signOutAction()}>
          Sign out
        </Button>
      </Blueprint>
    </div>
  );
}
