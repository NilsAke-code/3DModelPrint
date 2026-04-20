# 3DModelPrint

Personal 3D model library and processing tool.

## Features

- Upload STL, OBJ (+MTL + textures), and GLB files
- Automatic preview generation (4 angles + STL-style render)
- Per-user private model library
- Light/Dark theme toggle (persisted)

## Tech Stack

- **Frontend:** React 19 + TypeScript + Tailwind CSS + Three.js
- **Backend:** ASP.NET Core 10 Minimal API
- **Database:** SQL Server + EF Core (code-first)
- **Orchestration:** .NET Aspire

## Getting Started

### Prerequisites

- .NET 10 SDK
- Node.js 20+
- SQL Server (local or container)

### Run

```bash
# Start backend + Aspire orchestration
cd ModelPrint.AppHost
dotnet run

# Start frontend
cd modelprint-frontend
npm install
npm run dev
```

## Project Structure

```
ModelPrint.Api/          # ASP.NET Core Minimal API
ModelPrint.AppHost/      # .NET Aspire orchestration
modelprint-frontend/     # React frontend
```
