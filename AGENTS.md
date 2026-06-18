<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Security Notes

- **Never commit `.env` files to git.** `.env`, `.env.local`, and `.env.production` contain secrets and must stay local-only. They are already listed in `.gitignore`.
- **IMPORTANT: Rotate Supabase keys if `.env` was ever committed to a public repo.** If the `.env` file has been exposed (e.g., pushed to GitHub), the Supabase credentials inside it should be rotated immediately to prevent unauthorized access.
