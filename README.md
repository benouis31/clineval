# ClinEval Next.js + Supabase Starter

This is a starter implementation for a hosted ClinEval platform.

## What it supports

- One public web link for reviewers
- Reviewer code access
- Assigned clinical cases
- Sequential checkpoints CP1 to CP4
- Autosave answers to Supabase
- Reviewers can return and modify before final submission
- Final submission locks the evaluation
- Admin dashboard skeleton for progress monitoring
- Supabase SQL schema included

## 1. Install

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## 2. Create Supabase project

Go to Supabase, create a project, then open SQL Editor and run:

```text
supabase/schema.sql
```

## 3. Environment variables

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 4. Add sample data

In Supabase, add:

- one reviewer in `reviewers`
- one case in `cases`
- one assignment in `assignments`

Example reviewer code:

```text
PROF_01
```

## 5. Reviewer flow

Open:

```text
http://localhost:3000/reviewer
```

Enter reviewer code, then complete assigned case.

## 6. Admin flow

Open:

```text
http://localhost:3000/admin
```

This page shows assignments, progress, and submission status.

## Important

This is a starter scaffold, not a production-secure medical platform yet. Before real clinical deployment, add:

- institutional authentication
- row-level security policies
- audit logs
- encrypted backups
- ethics/GDPR review
- proper server-side admin authorization
