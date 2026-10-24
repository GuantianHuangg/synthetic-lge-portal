# Synthetic LGE Research Portal

An English, interactive research-workflow demonstration, prepared for GitHub Pages. This repository hosts the website only. No server purchase, custom domain, ChatGPT login, or software build is required.

## Publish on GitHub Pages

1. Create a repository named `synthetic-lge-portal`. GitHub Free requires a **public** repository for Pages; the HTML, CSS and JavaScript will be public.
2. Upload this repository's files and the entire `docs` directory to the `main` branch. Keep `docs/index.html` directly inside `docs`. If using the ZIP package, extract it first; uploading a ZIP alone does not publish a website.
3. Open **Settings → Pages → Build and deployment**.
4. Select **Deploy from a branch**, branch **main**, folder **/docs**, then **Save**.
5. Wait for the Pages deployment to succeed. Use the actual website URL displayed in Settings. The default project address follows `https://YOUR-USERNAME.github.io/synthetic-lge-portal/`; this is a format example, not an already published site.

All application assets use relative paths and work under a repository subpath. `docs/.nojekyll` disables unnecessary Jekyll processing. Future commits to the selected publishing branch update the website.

Official instructions: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Demo behavior

- The interface is English and visitors do not need an account.
- DICOM inspection takes place locally in the browser. At final review, the applicant explicitly authorizes email delivery of the three original DICOM files. This check and ZIP packaging do not anonymize files or perform clinical quality control.
- Application records exist only in browser memory. Reloading resets them to examples. There is no administrator database.
- QC decisions, agreements, model execution and output images are demonstrations. No trained model, real signature service or quantitative evaluation is connected.
- A local-file application packages `SAX.dcm`, `T1_mapping.dcm`, `LGE_reference.dcm`, and a manifest as one ZIP, preserving all original DICOM bytes. The complete ZIP must not exceed 10,000,000 bytes. Original filenames and typed aliases are omitted; identifiers inside the DICOM would still be transmitted.
- Clicking **Submit & email DICOM ZIP** opens a standard FormSubmit multipart delivery in another tab to `huanggt37@163.com`. Complete any CAPTCHA or activation steps there. The original application stays in its tab. No separate notification-only email is generated for this submission.
- Opening the delivery tab does not prove inbox receipt. If activation is required, activate and resend the ZIP: FormSubmit does not retain pending file uploads. A deliberate resend may produce a duplicate. The application offers a ZIP download for inspection or manual delivery.
- Example applications have no files and retain the text-only notification flow. The recipient has confirmed receiving both local and online text notifications; attachment delivery must be verified separately.

## Network dependencies

The website scripts, styles, DICOM parser and icons are included locally. Google Fonts was replaced with system fonts in this export. FormSubmit is the only external application request and remains necessary for email notifications. GitHub Pages and FormSubmit accessibility from mainland China has not been verified; changing the domain alone does not guarantee reliable access.

GitHub Pages hosts the static interface. FormSubmit handles the optional email attachment transfer; there is no image repository or administrator database. Durable applications, institutional private image storage, model inference and signed PDFs require separate services. Do not place research images, participant records or server credentials in this repository.

Attachment transport reference: https://formsubmit.co/documentation (File uploads). Pending-upload limitation: https://formsubmit.co/help. The implementation preserves the service's default CAPTCHA protection.

## Verification

Run `node --test tests/*.test.mjs`. The tests check ZIP byte identity, CRC and directory structure, size rejection before file reads, and native multipart delivery using a mock DOM. Unit tests do not send email. Real attachment delivery must be checked with synthetic test data and recipient confirmation.

## Files

- `docs/`: the complete published website.
- `docs/vendor/`: vendored Cornerstone DICOM parser and its MIT license.
- `.gitignore`: excludes common local secrets and medical-data files.

This export is based on the previously published demo source at commit `0694982b1f7389edabc0d50381ae1af4957cb927`, with system fonts and GitHub Pages packaging. It does not include the former hosting identity, source Git history, models, images or other research-workspace files.
