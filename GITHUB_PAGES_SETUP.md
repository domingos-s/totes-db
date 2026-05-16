# GitHub Pages Setup for Totes.DB

Upload the contents of this folder to the root of your GitHub repository.

Then enable GitHub Pages:

1. Repository **Settings**
2. **Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`
5. Folder: `/root`
6. Save

Use the published GitHub Pages URL when creating and printing labels.

Why: the generated QR codes include the app URL. If you print labels while running on `localhost`, the QR codes will point to `localhost`, which will not work from your phone later.

Expected URL pattern:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO-NAME/#tote=TOTE-XXXX-XXXX
```

Data is stored locally in the browser. Export/import JSON to back up or sync records between devices.
