import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy | Sobrew Wholesale Portal',
  description: 'Privacy policy for the Sobrew Wholesale Ordering Portal.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      eyebrow="Privacy policy"
      title="Privacy Policy"
      intro="This policy explains how Sobrew handles information in connection with the Sobrew Wholesale Ordering Portal."
      sections={[
        {
          title: 'Information we collect',
          body: (
            <>
              <p>We collect the information needed to provide wholesale ordering services, including account details, business contact information, order history, product preferences, delivery or shipping details, and messages or notes submitted through the portal.</p>
              <p>We may also collect technical information such as device type, browser type, pages visited, timestamps, and basic performance or error data so we can keep the portal secure and reliable.</p>
            </>
          ),
        },
        {
          title: 'How we use information',
          body: <p>We use information to create and manage accounts, process and fulfill wholesale orders, communicate about orders and recurring shipments, provide customer support, maintain accurate records, improve the portal, prevent abuse, and meet legal, tax, accounting, or operational requirements.</p>,
        },
        {
          title: 'Service providers',
          body: <p>We use trusted service providers to operate the portal and related business systems, such as hosting, authentication, database storage, email delivery, analytics, order management, invoicing, and business reporting. These providers may process information only as needed to provide their services to Sobrew.</p>,
        },
        {
          title: 'Cookies and analytics',
          body: <p>The portal may use cookies or similar technologies for sign-in, session security, preferences, performance monitoring, and privacy-conscious analytics. You can control cookies through your browser settings, but some portal features may not work without required session cookies.</p>,
        },
        {
          title: 'Sharing information',
          body: <p>We do not sell personal information. We may share information with service providers, with your business account administrators, when needed to fulfill orders, when required by law, or to protect the rights, safety, and security of Sobrew, our customers, and the portal.</p>,
        },
        {
          title: 'Data retention',
          body: <p>We keep information for as long as needed to provide the portal, maintain business records, resolve disputes, comply with legal obligations, and support accounting, tax, security, and audit needs. Retention periods may vary depending on the type of information and our legal or operational requirements.</p>,
        },
        {
          title: 'Your choices',
          body: <p>You may contact us to request access to, correction of, or deletion of information associated with your account. We may need to retain certain records when required for legal, accounting, security, or legitimate business purposes.</p>,
        },
        {
          title: 'Security',
          body: <p>We use reasonable administrative, technical, and organizational safeguards designed to protect information. No online system is completely secure, so please use a strong password and contact us promptly if you believe your account has been accessed without permission.</p>,
        },
        {
          title: 'Contact us',
          body: <p>Questions about this policy or Sobrew privacy practices can be sent to <a className="font-semibold text-teal-800 underline" href="mailto:hello@sobrew.com">hello@sobrew.com</a>.</p>,
        },
      ]}
    />
  );
}
