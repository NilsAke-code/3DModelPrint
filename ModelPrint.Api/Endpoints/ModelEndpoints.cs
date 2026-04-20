using System.Security.Claims;
using ModelPrint.Api.Models;
using ModelPrint.Api.Repositories;
using ModelPrint.Api.Services;

namespace ModelPrint.Api.Endpoints;

public static class ModelEndpoints
{
    public static void MapModelEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/models");

        group.MapGet("/", async (
            string? search, string? category, string? tag, string? sort,
            ModelRepository repo) =>
        {
            var models = await repo.GetAllAsync(search, category, tag, sort ?? "newest");
            return Results.Ok(models);
        });

        // Returns seed records that the browser pipeline hasn't completed yet (FilePath == "")
        group.MapGet("/pending-seeds", async (ModelRepository repo) =>
        {
            var models = await repo.GetPendingSeedsAsync();
            return Results.Ok(models);
        });

        group.MapGet("/{id:int}", async (int id, ModelRepository repo) =>
        {
            var model = await repo.GetByIdAsync(id);
            return model is null ? Results.NotFound() : Results.Ok(model);
        });

        group.MapPost("/", async (
            HttpRequest request,
            ModelRepository repo,
            FileStorageService fileStorage) =>
        {
            var user = request.HttpContext.User;
            var authorId = user.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? user.FindFirstValue("oid")
                ?? throw new UnauthorizedAccessException("No user identity found.");
            var authorName = user.FindFirstValue("name")
                ?? user.FindFirstValue(ClaimTypes.Name)
                ?? "Unknown";

            var form = await request.ReadFormAsync();
            var modelFile = form.Files.GetFile("modelFile");
            var generatedThumbnail = form.Files.GetFile("generatedThumbnail");

            if (modelFile is null)
                return Results.BadRequest("Model file is required.");
            if (generatedThumbnail is null)
                return Results.BadRequest("Generated thumbnail is required.");

            var filePath = await fileStorage.SaveModelFileAsync(modelFile);
            var thumbnailPath = await fileStorage.SaveGalleryImageAsync(generatedThumbnail);

            var tags = form["tags"].ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList();

            var model = new Model3D
            {
                Title = form["title"].ToString(),
                Description = form["description"].ToString(),
                Category = form["category"].ToString(),
                FilePath = filePath,
                ThumbnailPath = "",
                AuthorId = authorId,
                AuthorName = authorName,
                Tags = tags
            };

            var id = await repo.CreateAsync(model);
            await repo.AddImageAsync(id, thumbnailPath, 0);

            for (int i = 0; i < 4; i++)
            {
                var galleryFile = form.Files.GetFile($"galleryImage{i}");
                if (galleryFile is not null)
                {
                    var galleryPath = await fileStorage.SaveGalleryImageAsync(galleryFile);
                    await repo.AddImageAsync(id, galleryPath, i + 1);
                }
            }

            return Results.Created($"/api/models/{id}", new { id });
        }).RequireAuthorization();

        group.MapPut("/{id:int}", async (int id, UpdateModelRequest request, HttpContext httpContext, ModelRepository repo) =>
        {
            var model = await repo.GetByIdAsync(id);
            if (model is null) return Results.NotFound();

            var userId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? httpContext.User.FindFirstValue("oid");
            if (model.AuthorId != userId) return Results.Forbid();

            await repo.UpdateAsync(id, request);
            return Results.NoContent();
        }).RequireAuthorization();

        group.MapDelete("/{id:int}", async (int id, HttpContext httpContext, ModelRepository repo, FileStorageService fileStorage) =>
        {
            var model = await repo.GetByIdAsync(id);
            if (model is null) return Results.NotFound();

            var userId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? httpContext.User.FindFirstValue("oid");
            if (model.AuthorId != userId) return Results.Forbid();

            if (!string.IsNullOrEmpty(model.FilePath)) fileStorage.DeleteFile(model.FilePath);
            if (!string.IsNullOrEmpty(model.ThumbnailPath)) fileStorage.DeleteFile(model.ThumbnailPath);

            await repo.DeleteAsync(id);
            return Results.NoContent();
        }).RequireAuthorization();

        group.MapGet("/{id:int}/download", async (int id, HttpContext httpContext, ModelRepository repo, UserRepository userRepo, FileStorageService fileStorage) =>
        {
            var model = await repo.GetByIdAsync(id);
            if (model is null) return Results.NotFound();

            int? userId = null;
            var microsoftId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? httpContext.User.FindFirstValue("oid");
            if (microsoftId is not null)
            {
                var user = await userRepo.GetByMicrosoftIdAsync(microsoftId);
                userId = user?.Id;
            }

            await repo.IncrementDownloadsAsync(id, userId);

            var fullPath = fileStorage.GetFullPath(model.FilePath);
            if (!File.Exists(fullPath)) return Results.NotFound("File not found on disk.");

            var contentType = Path.GetExtension(fullPath).ToLower() switch
            {
                ".stl" => "application/sla",
                ".3mf" => "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
                _ => "application/octet-stream"
            };

            return Results.File(fullPath, contentType, Path.GetFileName(model.FilePath));
        }).RequireAuthorization();

        group.MapPost("/{id:int}/like", async (int id, ModelRepository repo) =>
        {
            if (!await repo.ExistsAsync(id)) return Results.NotFound();
            await repo.IncrementLikesAsync(id);
            return Results.Ok();
        });

        // Open endpoint for client-side thumbnail auto-generation (no auth required)
        // Accepts cover + up to 4 gallery images (gallery0–3); gallery3 is the STL-style preview
        group.MapPost("/{id:int}/seed-images", async (
            int id, HttpRequest request,
            ModelRepository repo, FileStorageService fileStorage) =>
        {
            if (!await repo.ExistsAsync(id)) return Results.NotFound();
            var form = await request.ReadFormAsync();
            var cover = form.Files.GetFile("cover");
            if (cover is null) return Results.BadRequest("cover file is required.");

            var images = new List<(string ImagePath, int SortOrder)>();
            images.Add((await fileStorage.SaveGalleryImageAsync(cover), 0));
            for (int i = 0; i < 4; i++)  // gallery0–3 (gallery3 = STL-style preview)
            {
                var gf = form.Files.GetFile($"gallery{i}");
                if (gf is not null)
                    images.Add((await fileStorage.SaveGalleryImageAsync(gf), i + 1));
            }
            await repo.ReplaceAllImagesAsync(id, images);
            return Results.Ok(new { count = images.Count });
        });

        // Upload the browser-generated STL for a seed model (no auth required)
        group.MapPost("/{id:int}/seed-file", async (
            int id, HttpRequest request,
            ModelRepository repo, FileStorageService fileStorage) =>
        {
            if (!await repo.ExistsAsync(id)) return Results.NotFound();
            var form = await request.ReadFormAsync();
            var file = form.Files.GetFile("file");
            if (file is null) return Results.BadRequest("file is required.");
            var filePath = await fileStorage.SaveModelFileAsync(file);
            await repo.UpdateFilePathAsync(id, filePath);
            return Results.Ok(new { filePath });
        });

        // Delete an incomplete seed record (FilePath == "") — no auth required.
        // Cannot delete completed models (those with a real FilePath), so this is safe to expose openly.
        group.MapDelete("/{id:int}/seed-cleanup", async (int id, ModelRepository repo) =>
        {
            var model = await repo.GetByIdAsync(id);
            if (model is null) return Results.NotFound();
            if (!string.IsNullOrEmpty(model.FilePath))
                return Results.Conflict("Cannot cleanup a completed model record.");
            await repo.DeleteAsync(id);
            return Results.NoContent();
        });

        group.MapPost("/{id:int}/images", async (
            int id, HttpRequest request,
            ModelRepository repo, UserRepository userRepo, FileStorageService fileStorage) =>
        {
            if (!await IsAdminAsync(request.HttpContext, userRepo)) return Results.Forbid();
            if (!await repo.ExistsAsync(id)) return Results.NotFound();

            var form = await request.ReadFormAsync();
            var cover = form.Files.GetFile("cover");
            if (cover is null) return Results.BadRequest("cover file is required.");

            var images = new List<(string ImagePath, int SortOrder)>();
            images.Add((await fileStorage.SaveGalleryImageAsync(cover), 0));

            for (int i = 0; i < 3; i++)
            {
                var galleryFile = form.Files.GetFile($"gallery{i}");
                if (galleryFile is not null)
                    images.Add((await fileStorage.SaveGalleryImageAsync(galleryFile), i + 1));
            }

            await repo.ReplaceAllImagesAsync(id, images);
            return Results.Ok(new { count = images.Count });
        }).RequireAuthorization();
    }

    private static async Task<bool> IsAdminAsync(HttpContext httpContext, UserRepository userRepo)
    {
        var microsoftId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? httpContext.User.FindFirstValue("oid");
        if (microsoftId is null) return false;
        var user = await userRepo.GetByMicrosoftIdAsync(microsoftId);
        return user?.Role == 2;
    }
}
