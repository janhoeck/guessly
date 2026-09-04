"use server";

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { adminPassword } from "@/lib/config";
import { passwordMatches, safeReturnPath } from "@/lib/session";

export interface LoginState {
  error: string | null;
}

/**
 * The one door in. A wrong password is told plainly and nothing else is;
 * a missing `ADMIN_PASSWORD` is told too, because the person at this form
 * is the operator, and "nobody can sign in" is the thing they need to hear.
 */
export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const given = form.get("password");
  const next = safeReturnPath(form.get("next"));

  let expected: string;
  try {
    expected = adminPassword();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  if (typeof given !== "string" || !(await passwordMatches(given, expected))) {
    return { error: "That is not the password." };
  }

  await signIn();
  redirect(next);
}

export async function logout(): Promise<void> {
  await signOut();
  redirect("/login");
}
