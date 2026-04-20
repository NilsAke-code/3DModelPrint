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

## Design System (UPDATED)

### Theme: Soft Dark (Adjusted Again)

Goal:
- softer and more readable dark UI
- clearer separation between page, sidebar, cards, and inputs
- avoid compressed near-black surfaces

Colors:
- Main background: #141414
- Sidebar / secondary surfaces: #1c1c1c
- Cards: #242424
- Elevated surfaces / inputs: #2b2b2b
- Borders: #3a3a3a

Text:
- primary: #f0f0f0
- secondary: #b8b8b8

Accent:
- subtle neutral accent, no neon

---

### Style

* minimal
* modern
* soft contrast (NOT high contrast black/white)
* comfortable to look at long-term

---

### Cards

* rounded-xl
* soft shadows
* slightly lighter than background
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
