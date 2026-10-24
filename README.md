# Green Bites on Netlify

Customers order with no Claude sign-in. Every order reaches your admin panel from any browser. Data is kept in Netlify Blobs, which is built into Netlify.

## Files
- `public/index.html`: the site
- `netlify/functions/api.mjs`: the order server (a Netlify function)
- `netlify.toml`, `package.json`: Netlify settings

## Deploy (use GitHub; plain drag-and-drop does not install the function's package)
1. Create a free account at github.com and a new Private repository called green-bites.
2. Upload everything from inside this folder (package.json, netlify.toml, README.md, the netlify folder and the public folder). Do not upload the zip.
3. In Netlify: Add new site > Import an existing project > GitHub > choose green-bites. Leave the build settings as they are and deploy.
   (If you already have a Netlify site made by drag-and-drop, make a new site this way. You can rename or delete the old one later.)
4. Open the site > Site configuration > Environment variables > Add a variable:
   - Key: `ADMIN_PASSWORD`  Value: your own strong password
5. Deploys > Trigger deploy > Deploy site (so the password is picked up).
6. Open your Netlify link. Tap the logo 5 times, enter the password, and open Orders.

## Good to know
- Each open page checks for updates every few seconds. A small shop fits easily in Netlify's free limits. Many customers browsing at once uses the monthly request allowance faster.
- The home video stays on the admin's own device; it is not shared with customers.
- To change the password, edit `ADMIN_PASSWORD` and redeploy.
