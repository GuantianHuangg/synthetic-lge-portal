# Synthetic LGE Research Portal

An English application portal for external synthetic LGE research evaluation, hosted on GitHub Pages. Researchers provide their contact email and paired DICOM sample; the research team reviews the request and replies manually by email. No account, server purchase, custom domain, or software build is required.

Live website: https://guantianhuangg.github.io/synthetic-lge-portal/

## Publish on GitHub Pages

1. Create a repository named `synthetic-lge-portal`. GitHub Free requires a **public** repository for Pages; the HTML, CSS and JavaScript will be public.
2. Upload this repository's files and the entire `docs` directory to the `main` branch. Keep `docs/index.html` directly inside `docs`. If using the ZIP package, extract it first; uploading a ZIP alone does not publish a website.
3. Open **Settings → Pages → Build and deployment**.
4. Select **Deploy from a branch**, branch **main**, folder **/docs**, then **Save**.
5. Wait for the Pages deployment to succeed. Use the actual website URL displayed in Settings. The default project address follows `https://YOUR-USERNAME.github.io/synthetic-lge-portal/`; this is a format example, not an already published site.

All application assets use relative paths and work under a repository subpath. `docs/.nojekyll` disables unnecessary Jekyll processing. Future commits to the selected publishing branch update the website.

Official instructions: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Applicant workflow

- The interface is English and visitors do not need an account.
- Applicant email is required and validated before continuing and before email delivery. The outgoing email contains the applicant email, project, sample alias, purpose, input protocol, reference, and submission time. Its Reply-To points to the applicant so the team can reply directly. The recipient remains `huanggt37@163.com`.
- There are no submission counts, shared application lists, seeded records, reviewer controls, simulated approvals, or automatic generation/results screens. Only the current draft and receipt exist in browser memory; refreshing clears them. There is no administrator database or live review-status service.
- The team reviews eligibility, quality, research-use terms, and any results outside the website, then replies by email. No trained model, signature service, or quantitative evaluation runs on this site.
- DICOM inspection takes place locally. The SAX object must contain 25 frames; a human still checks continuity, image quality, and anatomical pairing. T1 mapping and reference LGE must correspond to the SAX slice. Geometric offsets do not imply an unconfigured acceptance tolerance.
- The applicant explicitly authorizes delivery at final review. `SAX.dcm`, `T1_mapping.dcm`, `LGE_reference.dcm`, and a manifest are packaged as one ZIP, preserving all original DICOM bytes. The complete ZIP must not exceed 10,000,000 bytes. Original filenames are omitted; identifiers inside the DICOM would still be transmitted. Packaging does not anonymize data.
- **Send application & DICOM ZIP** opens a standard FormSubmit multipart delivery in another tab. The original application remains in its tab. No separate notification-only email is generated.
- Real submission is allowed only from the canonical HTTPS GitHub Pages origin and portal path. Localhost and other previews return a non-delivery message without opening FormSubmit or uploading files. `_url` is fixed to the live portal URL for a consistent source address.
- Opening the delivery tab does not prove inbox receipt. Applicants complete any service CAPTCHA; only the receiving mailbox owner handles activation. If activation is required, activate and resend the ZIP: pending uploads are not retained. A deliberate resend may produce a duplicate. The portal offers ZIP and application-summary downloads.
- The owner previously confirmed receipt of an email with a ZIP attachment. The new applicant-email/Reply-To fields and repeat-activation correction have been checked locally, but need a real production receipt to verify service behavior. A fixed `_url` follows FormSubmit guidance; it is not a guarantee that a service-side activation issue is resolved.

## Network dependencies

The website scripts, styles, DICOM parser and icons are included locally. Google Fonts was replaced with system fonts in this export. FormSubmit is the only external application request and remains necessary for email notifications. GitHub Pages and FormSubmit accessibility from mainland China has not been verified; changing the domain alone does not guarantee reliable access.

GitHub Pages hosts the static interface. FormSubmit handles the authorized email attachment transfer; there is no image repository or administrator database. Durable applications, institutional private image storage, model inference and signed PDFs require separate services. Do not place research images, participant records or server credentials in this repository.

Attachment transport reference: https://formsubmit.co/documentation (File uploads). Pending-upload limitation: https://formsubmit.co/help. The implementation preserves the service's default CAPTCHA protection.

## Verification

Run `node --test tests/*.test.mjs`. Tests cover ZIP byte identity and CRC, size limits, required applicant details, malformed addresses and header injection, Reply-To fields, stable source URL, production-only delivery, popup failures, and native multipart attachment bytes using a mock DOM. Unit tests do not send email. Real attachment delivery and recurring activation behavior require synthetic test data and recipient confirmation.

## Files

- `docs/`: the complete published website.
- `docs/vendor/`: vendored Cornerstone DICOM parser and its MIT license.
- `.gitignore`: excludes common local secrets and medical-data files.

This export is based on the previously published demo source at commit `0694982b1f7389edabc0d50381ae1af4957cb927`, with system fonts and GitHub Pages packaging. It does not include the former hosting identity, source Git history, models, images or other research-workspace files.
