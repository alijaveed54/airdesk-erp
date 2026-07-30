import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy Policy | Mysmar ERP",
  description:
    "Privacy policy for Mysmar ERP and its Facebook Page management features.",
};

const LAST_UPDATED = "30 July 2026";

export default function PrivacyPolicyPage() {
  const privacyEmail =
    process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim() || "";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 bg-gradient-to-r from-slate-950 to-slate-800 px-6 py-10 text-white sm:px-10">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-300">
            Mysmar ERP
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            This policy explains how Mysmar ERP handles information when users
            connect Facebook Pages, publish content, and use the ERP.
          </p>
          <p className="mt-4 text-xs font-bold text-slate-400">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="space-y-9 px-6 py-8 sm:px-10 sm:py-10">
          <PolicySection title="1. Scope">
            <p>
              This Privacy Policy applies to Mysmar ERP, including its Facebook
              Page management, posting, scheduling, order-management, inventory,
              supplier, reporting, and administrative features.
            </p>
          </PolicySection>

          <PolicySection title="2. Information We Process">
            <p>Depending on the features used, Mysmar ERP may process:</p>
            <ul>
              <li>Facebook Page names, Page IDs, and Page access permissions.</li>
              <li>
                Facebook access tokens required to perform authorized Page
                actions.
              </li>
              <li>
                Post captions, images, media URLs, scheduled times, publishing
                status, and Facebook post identifiers.
              </li>
              <li>
                ERP account information such as username, role, company or base
                access, and permissions.
              </li>
              <li>
                Business records entered into the ERP, including orders,
                products, suppliers, customers, inventory, and related changes.
              </li>
              <li>
                Technical information needed for security, troubleshooting, and
                reliable operation.
              </li>
            </ul>
          </PolicySection>

          <PolicySection title="3. How We Use Information">
            <p>Information is used only to:</p>
            <ul>
              <li>Connect and manage authorized Facebook Pages.</li>
              <li>Publish or schedule content requested by an authorized user.</li>
              <li>Operate ERP workflows and role-based access controls.</li>
              <li>Maintain business records and change history.</li>
              <li>Detect errors, prevent abuse, and improve reliability.</li>
            </ul>
          </PolicySection>

          <PolicySection title="4. Facebook Platform Data">
            <p>
              Mysmar ERP accesses Facebook data only after an authorized user
              grants the required permissions. The application does not use
              Facebook data for advertising, profiling, or sale to third
              parties.
            </p>
            <p>
              Users may revoke access through their Facebook settings or by
              disconnecting the relevant Facebook Page from Mysmar ERP.
            </p>
          </PolicySection>

          <PolicySection title="5. Service Providers">
            <p>
              Mysmar ERP may use third-party infrastructure and data-processing
              services, including Meta, Vercel, Airtable, Cloudflare R2, and
              Turso, only as required to provide the application&apos;s
              functionality.
            </p>
          </PolicySection>

          <PolicySection title="6. Data Retention">
            <p>
              Information is retained only for as long as reasonably required
              for business operations, security, troubleshooting, legal
              obligations, or the purpose for which it was collected. Access
              tokens are retained while the related Facebook Page remains
              connected or until access is revoked.
            </p>
          </PolicySection>

          <PolicySection title="7. Data Deletion Instructions" id="data-deletion">
            <p>A user may request deletion of Facebook-related data by:</p>
            <ol>
              <li>
                Removing the app from Facebook&apos;s Business Integrations or
                connected-app settings.
              </li>
              <li>
                Disconnecting the Facebook Page inside Mysmar ERP, where that
                option is available.
              </li>
              <li>
                Contacting the Mysmar ERP administrator and identifying the Page
                or account whose data should be removed.
              </li>
            </ol>
            <p>
              After a valid request is confirmed, applicable stored tokens and
              Facebook-related records will be deleted or anonymized, except
              where retention is required for security, legal, or legitimate
              business-record obligations.
            </p>
          </PolicySection>

          <PolicySection title="8. Data Sharing">
            <p>
              Mysmar ERP does not sell personal information or Facebook Platform
              Data. Information is shared only with authorized users,
              infrastructure providers, or authorities where required by law.
            </p>
          </PolicySection>

          <PolicySection title="9. Security">
            <p>
              Reasonable technical and organizational safeguards are used to
              protect information, including role-based access controls,
              restricted credentials, encrypted network connections, and
              controlled access to production systems.
            </p>
          </PolicySection>

          <PolicySection title="10. Children">
            <p>
              Mysmar ERP is a business application and is not intended for
              children under 13.
            </p>
          </PolicySection>

          <PolicySection title="11. Changes to This Policy">
            <p>
              This policy may be updated when application features, service
              providers, or legal requirements change. The latest version will
              remain available on this page.
            </p>
          </PolicySection>

          <PolicySection title="12. Contact">
            {privacyEmail ? (
              <p>
                Privacy questions and deletion requests may be sent to{" "}
                <a
                  href={`mailto:${privacyEmail}`}
                  className="font-black text-blue-700 underline underline-offset-4"
                >
                  {privacyEmail}
                </a>
                .
              </p>
            ) : (
              <p>
                Privacy questions and deletion requests should be submitted to
                the Mysmar ERP administrator through the organization&apos;s
                usual support or business-contact channel.
              </p>
            )}
          </PolicySection>

          <div className="border-t border-slate-200 pt-6">
            <Link
              href="/login"
              className="inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800"
            >
              Return to Mysmar ERP
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}

function PolicySection({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-xl font-black text-slate-950">{title}</h2>
      <div className="mt-3 space-y-3 text-sm font-medium leading-7 text-slate-600 [&_li]:ml-5 [&_li]:pl-1 [&_ol]:list-decimal [&_ul]:list-disc">
        {children}
      </div>
    </section>
  );
}
