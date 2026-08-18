import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import TimelinesClient from "./TimelinesClient";

export const dynamic = "force-dynamic";

export default async function TimelinesPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role !== "Admin" && !session.superAdmin) {
    redirect("/dashboard");
  }

  return <TimelinesClient />;
}
