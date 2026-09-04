import { AdminHeader } from "@/components/site/admin-header";

/**
 * Everything behind the door shares this: the header, and the rule that no
 * page under it is ever rendered ahead of time. Every one of them reads the
 * bank, and a page prerendered at build would be a shelf as it stood on the
 * build machine — or a build that fails for want of a database.
 */
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10 sm:py-12">
        {children}
      </main>
    </>
  );
}
