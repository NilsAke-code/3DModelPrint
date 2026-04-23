# 3DModelPrint — Project Guide

## Project Direction

This project is a **personal 3D model library system with integrated processing tools**.

Core idea:

* Users import or upload 3D models (STL, OBJ+MTL+textures, GLB)
* Models are stored in a **private, structured library per user**
* The system enhances models through:

  * clean previews
  * consistent thumbnails
  * STL-style render

Goal:

> “Build a clean, reliable personal library for 3D models, where every model is organized, previewable, and ready for use or printing.”

Primary focus:

* structured, usable model library
* fast and smooth model import
* clear visual overview of stored models

Secondary focus:

* model processing
* preview generation
* print-readiness improvements

Avoid:

* public sharing features
* unnecessary complexity
* demo-style placeholder logic

---

## Tech Stack

* Orchestration: .NET Aspire
* Frontend: React 19 + TypeScript + Tailwind CSS + Three.js
* Backend: ASP.NET Core 10 Minimal API
* Database: SQL Server + EF Core (code-first)
* Files: stored on disk (`/uploads/`), NOT in DB

---

## Core Product Areas

### Model Library (PRIMARY FOCUS)

* Private per-user library (NOT shared)

Each model should show:

* preview image
* title
* status (ready / missing textures / etc)
* optional source reference

Must feel:

* clean
* structured
* easy to scan
* genuinely useful

Avoid:

* global browsing
* shared collections

---

### Upload / Import

* Accept:

  * STL
  * OBJ + MTL + textures
  * GLB

* Support:

  * local upload
  * URL-based import (fetch → process → store per user)

* Automatically:

  * detect file type
  * load model correctly
  * generate previews
  * generate STL-style render

* Support:

  * multiple companion files
  * texture validation (MTL parsing)
  * reset/remove flow

Rules:

* Models must remain private per user
* No shared/global access
* Never silently fail

---

### Model Processing (SECONDARY)

* Normalize geometry:

  * center XZ
  * seat at y=0
  * fix orientation if needed

* Generate:

  * 4 preview renders (cover/front/side/elevated)
  * 1 STL-style render

* Preserve:

  * GLB PBR materials
  * OBJ materials via MTL + textures

* Convert:

  * MeshPhong → MeshStandardMaterial

---

## Rendering Rules (CRITICAL)

### Single Renderer Rule

Only ONE WebGLRenderer in the app (SharedModelRenderer)

### Material Rules

* Always use MeshStandardMaterial (PBR)
* Never use MeshBasicMaterial
* Convert MTL materials to PBR

### GLB Priority

* GLB = best quality → preserve materials fully
* OBJ = requires MTL + textures
* STL = geometry only → default material

### Camera Framing

* Fit model using bounding box
* Distance ~ `maxDim * 2.4`
* Look at center with slight Y offset (~0.45 height)

### Lighting

* neutral, soft
* no color tinting
* clear contrast

### Background

* neutral grey tones (NOT pure black)
* avoid overly dark scenes

---

## STL-Style Preview

Purpose:

* simulate print appearance

Rules:

* single material (dark grey)
* no textures
* strong shape readability

### Bed (IMPORTANT)

* light blue grid
* centered under model
* not full width
* sized to model bounds + padding

---

## Hover System

* Thumbnail = static image
* Hover = WebGL overlay

Rules:

* no snapping
* no flicker
* consistent starting pose

---

## Upload UX Rules

* smooth and predictable
* clear feedback
* removable/resettable at any time

If textures missing:

* show warning clearly

Never:

* silently fail

---

## Design System

### Theme: Warm Industrial Dark

Goal:
- clean, tool-focused dark UI with warm character
- neutral base surfaces — brown/orange used only for accents
- depth through layering, not color saturation

### Color Palette

Warm accents (fixed across light/dark):
- Primary accent:  #80430E
- Hover accent:    #A98759
- Highlight:       #E2BE80 (small UI details only — never full surfaces)

Neutral surfaces (dark mode):
- Main background: #121212
- Sidebar / panels: #1c1c1c
- Cards: #242424
- Elevated / inputs: #2b2b2b
- Borders: #2e2e2e

Neutral surfaces (light mode):
- Background: #f8f8f8
- Cards: #ffffff
- Borders: #e5e5e5

Text:
- primary: #f0f0f0
- secondary: #b8b0a3 (warm neutral, not blue-grey)

Status tokens:
- success: #4ade80
- warning: #E2BE80
- error:   #f87171

### Rules

* Never use brown/orange tones as full backgrounds
* Use warm palette ONLY for: buttons, active nav borders, hover borders, small highlights
* Primary buttons: bg-accent → hover bg-accent-hover, text white
* Highlight (#E2BE80): hover/selected states and small labels only
* Active nav: border-l border-accent + bg-accent/10, text-highlight
* Cards: hover border-accent/30 + slight lift

---

### Style

* minimal
* modern
* soft contrast (NOT high contrast black/white)
* slightly industrial — clean tool aesthetic
* comfortable to look at long-term

---

### Cards

* rounded-xl
* soft shadows
* slightly lighter than background
* warm accent border on hover
* smooth hover transitions

---

## Animations

Keep:

* hover 3D activation
* card tilt/parallax

Add:

* subtle fade/scale
* smooth loading transitions

Rules:

* no jitter
* no aggressive motion

---

## EF Core Rules

* Code-first only
* No manual DB edits
* Repositories = scoped
* Files stored on disk

---

## Hard Rules

* Never store binary files in DB
* Always isolate models per user
* No public exposure of models
* Prioritize visual correctness over hacks
* Reuse pipeline before adding new systems
* Keep code modular and clean
