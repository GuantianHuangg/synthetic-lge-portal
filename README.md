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
- DICOM inspection takes place locally in the browser; image files are not uploaded. This check is not anonymization or clinical quality control.
- Application records exist only in browser memory. Reloading resets them to examples. There is no administrator database.
- QC decisions, agreements, model execution and output images are demonstrations. No trained model, real signature service or quantitative evaluation is connected.
- Creating an application makes a real notification request to FormSubmit for `huanggt37@163.com`. Only an opaque demo reference, workflow event, timestamp and fixed demo notice are sent. Images, file names, DICOM metadata, typed aliases and signed documents are excluded.
- FormSubmit acknowledgment is not proof of inbox delivery. A timeout leaves delivery unknown; retries may duplicate a message. The recipient has reported activating FormSubmit, but receipt from the future GitHub Pages origin still needs to be checked after deployment.

## Network dependencies

The website scripts, styles, DICOM parser and icons are included locally. Google Fonts was replaced with system fonts in this export. FormSubmit is the only external application request and remains necessary for email notifications. GitHub Pages and FormSubmit accessibility from mainland China has not been verified; changing the domain alone does not guarantee reliable access.

GitHub Pages hosts static files. Real image reception, durable applications, model inference and signed PDFs require separate services if the project progresses beyond this demo. Do not place research images, participant records or server credentials in this repository.

## Files

- `docs/`: the complete published website.
- `docs/vendor/`: vendored Cornerstone DICOM parser and its MIT license.
- `.gitignore`: excludes common local secrets and medical-data files.

This export is based on the previously published demo source at commit `0694982b1f7389edabc0d50381ae1af4957cb927`, with system fonts and GitHub Pages packaging. It does not include the former hosting identity, source Git history, models, images or other research-workspace files.
