# GitHub guide for this tracker

## What each part means

| GitHub term | What it means here |
| --- | --- |
| Repository, or repo | Your project's online folder: https://github.com/eltru892/chinaslop-tracker |
| Code | The source files used to build the tracker |
| README | The project's front page and setup instructions |
| Commit | A saved snapshot of changes, with a short explanation |
| Clone | Make a working copy of the repository on your computer |
| Push | Upload your local commits to GitHub |
| Pull | Download newer commits into your local copy |
| Release | A named app version with downloadable EXE/APK files |
| Tag | A version label, such as `v1.0.0`, pointing to a commit |
| Issues | Bug reports and feature requests |
| Actions | Automated checks; this repository runs its tests here |

## Download and use the app

1. Open [Releases](https://github.com/eltru892/chinaslop-tracker/releases).
2. Open a version and expand **Assets** if needed.
3. Choose the Windows EXE or Android APK for your device.
4. Open/install it, set your encryption password, and connect your accounts.

The **Code → Download ZIP** button downloads development files. Use the release EXE/APK to install the finished app.

## Make changes using GitHub Desktop

[GitHub Desktop's official getting-started guide](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop) explains installation and sign-in.

1. Open GitHub Desktop and sign in to your GitHub account.
2. Choose **File → Clone repository**, then its **URL** option.
3. Paste `https://github.com/eltru892/chinaslop-tracker` and choose a local folder.
4. Open that folder in your editor or coding assistant and make the requested changes.
5. In GitHub Desktop, review the **Changes** list. Keep personal account files and signing keys out of it.
6. Enter a short summary, such as `Improve event timeline layout`, and select **Commit to main**. This saves the snapshot on your computer.
7. Select **Push origin** to put that commit on GitHub.
8. Open the repository's **Actions** tab and check that the tests pass.

If another computer or a collaborator changed the repository, use **Fetch origin**, then **Pull origin** to bring those changes into your copy before continuing.

## Publish a new app version

Updating source code does not rebuild or replace existing EXE/APK downloads.

1. Make and test the source changes, then commit and push them.
2. Increase the app version in the desktop and Android build files. Android also needs a higher `versionCode`.
3. Build the new Windows EXE and Android APK using the README instructions.
4. Sign the Android APK with the same private signing key used for the previous version. Keep that key private and backed up.
5. On GitHub, open **Releases → Draft a new release**.
6. Create a new version tag, such as `v1.0.1`, targeting the tested commit on `main`.
7. Give it a title, describe the changes, and attach the new EXE and APK.
8. Select **Publish release** when the files and notes are ready.

Share the repository link to show the project, or the Releases link to help people download it.

## Keep private data out of GitHub

The repository's `.gitignore` excludes saved credentials, local settings, history, generated runtimes, and signing keys. Review changes before pushing anyway. Never paste a HoYoLAB cookie, SKPORT token, unlock password, or signing-key password into source files, an Issue, a README, or release notes.

## Website versus repository

GitHub publishes the project's source and downloads. GitHub Pages serves static websites and cannot run this tracker's Node.js server. People run this app on their own device; their credentials are not uploaded to your repository.

Official references: [GitHub Desktop](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop), [managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
