import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { headers, cookies } from "next/headers";
import { CANDIDATE_COOKIE } from "@/lib/candidate-access";
import { candidateScope } from "@/lib/candidate-access-server";

export async function createContext() {
  const serverClient = await createClient();

  let user = null;
  try {
    const { data } = await serverClient.auth.getUser();
    user = data.user;
  } catch {
    // Suppress auth errors (e.g., invalid cookies on public pages)
  }

  if (!user) {
    try {
      const authorization = (await headers()).get("authorization");
      if (authorization?.startsWith("Bearer ")) {
        const { data } = await serverClient.auth.getUser(
          authorization.slice(7),
        );
        user = data.user;
      }
    } catch {
      // Suppress Bearer token errors
    }
  }

  const candidate = !user && process.env.AURAL_EXTERNAL_CANDIDATES === "true" ? await candidateScope((await cookies()).get(CANDIDATE_COOKIE)?.value) : null;
  return {
    candidate,
    user,
    supabase: supabaseAdmin,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
