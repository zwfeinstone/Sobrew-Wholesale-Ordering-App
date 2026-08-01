import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'End-User License Agreement | Sobrew Wholesale Portal',
  description: 'End-user license agreement for the Sobrew Wholesale Ordering Portal.',
};

export default function EulaPage() {
  return (
    <LegalPage
      eyebrow="End-user license agreement"
      title="End-User License Agreement"
      intro="This agreement describes the terms for accessing and using the Sobrew Wholesale Ordering Portal."
      sections={[
        {
          title: 'Acceptance',
          body: <p>By accessing or using the Sobrew Wholesale Ordering Portal, you agree to this End-User License Agreement. If you are using the portal on behalf of a business or organization, you represent that you are authorized to accept this agreement for that business or organization.</p>,
        },
        {
          title: 'License to use the portal',
          body: <p>Sobrew grants authorized users a limited, revocable, non-exclusive, non-transferable license to access and use the portal for wholesale ordering, account management, order review, recurring order management, and related business purposes.</p>,
        },
        {
          title: 'Accounts and access',
          body: <p>You are responsible for keeping your account credentials confidential and for activity under your account. You agree to provide accurate information, use the portal only for legitimate business purposes, and notify Sobrew promptly if you suspect unauthorized access.</p>,
        },
        {
          title: 'Restrictions',
          body: <p>You may not copy, modify, reverse engineer, resell, sublicense, interfere with, disrupt, or misuse the portal. You may not use the portal to violate laws, infringe rights, submit harmful code, attempt unauthorized access, or place fraudulent or unauthorized orders.</p>,
        },
        {
          title: 'Orders and business records',
          body: <p>Orders, recurring orders, product availability, pricing, shipping, delivery, invoicing, and fulfillment are subject to Sobrew business approval and operational requirements. Sobrew may correct errors, decline orders, adjust availability, or contact you to confirm order details when needed.</p>,
        },
        {
          title: 'Ownership',
          body: <p>Sobrew and its licensors retain all rights, title, and interest in the portal, including software, design, content, branding, workflows, and related intellectual property. This agreement does not transfer ownership of the portal or Sobrew intellectual property to you.</p>,
        },
        {
          title: 'Availability and changes',
          body: <p>Sobrew may update, suspend, restrict, or discontinue portal features at any time. We work to keep the portal reliable, but we do not guarantee uninterrupted, error-free, or fully available access.</p>,
        },
        {
          title: 'Disclaimer',
          body: <p>The portal is provided on an as-is and as-available basis. To the fullest extent permitted by law, Sobrew disclaims warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted or error-free operation.</p>,
        },
        {
          title: 'Limitation of liability',
          body: <p>To the fullest extent permitted by law, Sobrew will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost data, business interruption, or procurement of substitute services arising from use of the portal.</p>,
        },
        {
          title: 'Termination',
          body: <p>Sobrew may suspend or terminate access to the portal if we believe this agreement has been violated, access creates risk, an account is inactive, or termination is needed for operational, security, legal, or business reasons.</p>,
        },
        {
          title: 'Contact',
          body: <p>Questions about this agreement can be sent to <a className="font-semibold text-teal-800 underline" href="mailto:hello@sobrew.com">hello@sobrew.com</a>.</p>,
        },
      ]}
    />
  );
}
