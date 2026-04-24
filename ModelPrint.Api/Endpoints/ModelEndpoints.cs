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

        group.MapGet("/{id:int}/files", async (int id, ModelRepository repo, FileStorageService fileStorage) =>
        {
            var model = await repo.GetByIdAsync(id);
            if (model is null) return Results.NotFound();

            var entries = new List<object>();

            if (model.Parts.Count > 0)
            {
                // Package-imported model: expose parts in order
                foreach (var part in model.Parts.OrderBy(p => p.SortOrder))
                {
                    var fullPath = fileStorage.GetFullPath(part.FilePath);
                    long? size = File.Exists(fullPath) ? new FileInfo(fullPath).Length : null;
                    entries.Add(new
                    {
                        fileName = part.FileName,
                        role = AssignFileRole(Path.GetExtension(part.FileName)),
                        path = part.FilePath,
                        sizeBytes = size,
                    });
                }

                // Original archive if present
                if (!string.IsNullOrEmpty(model.PackagePath))
                {
                    var originalDir = fileStorage.GetFullPath(Path.Combine(model.PackagePath, "original"));
                    if (Directory.Exists(originalDir))
                    {
                        foreach (var zipFile in Directory.GetFiles(originalDir))
                        {
                            var pkgRel = $"{model.PackagePath}/original/{Path.GetFileName(zipFile)}";
                            entries.Add(new
                            {
                                fileName = Path.GetFileName(zipFile),
                                role = "archive",
                                path = pkgRel,
                                sizeBytes = (long?)new FileInfo(zipFile).Length,
                            });
                        }
                    }
                }
            }
            else if (!string.IsNullOrEmpty(model.FilePath))
            {
                // Direct-upload model: single file
                var fullPath = fileStorage.GetFullPath(model.FilePath);
                long? size = File.Exists(fullPath) ? new FileInfo(fullPath).Length : null;
                entries.Add(new
                {
                    fileName = Path.GetFileName(model.FilePath),
                    role = AssignFileRole(Path.GetExtension(model.FilePath)),
                    path = model.FilePath,
                    sizeBytes = size,
                });
            }

            return Results.Ok(entries);
        }).RequireAuthorization();

        group.MapGet("/{id:int}/files/{*path}", async (int id, string path, ModelRepository repo, FileStorageService fileStorage) =>
        {
            var model = await repo.GetByIdAsync(id);
            if (model is null) return Results.NotFound();

            if (string.IsNullOrEmpty(path) || path.Contains("..") || Path.IsPathRooted(path))
                return Results.BadRequest("Invalid path.");

            // Validate path belongs to this model
            bool allowed = false;
            if (model.Parts.Count > 0 && !string.IsNullOrEmpty(model.PackagePath))
            {
                allowed = path.StartsWith($"packages/{id}/", StringComparison.OrdinalIgnoreCase);
            }
            else if (!string.IsNullOrEmpty(model.FilePath))
            {
                allowed = string.Equals(path, model.FilePath, StringComparison.OrdinalIgnoreCase);
            }

            if (!allowed) return Results.Forbid();

            var fullPath = fileStorage.GetFullPath(path);
            if (!File.Exists(fullPath)) return Results.NotFound("File not found on disk.");

            var contentType = Path.GetExtension(fullPath).ToLowerInvariant() switch
            {
                ".stl"  => "application/sla",
                ".obj"  => "model/obj",
                ".glb"  => "model/gltf-binary",
                ".gltf" => "model/gltf+json",
                ".zip"  => "application/zip",
                _       => "application/octet-stream",
            };

            return Results.File(fullPath, contentType, Path.GetFileName(path));
        }).RequireAuthorization();

        group.MapPost("/{id:int}/favorite", async (int id, ModelRepository repo) =>
        {
            if (!await repo.ExistsAsync(id)) return Results.NotFound();
            var isFavorite = await repo.ToggleFavoriteAsync(id);
            return Results.Ok(new { isFavorite });
        }).RequireAuthorization();

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

    private static string AssignFileRole(string ext) => ext.ToLowerInvariant() switch
    {
        ".stl"  => "stl",
        ".obj"  => "obj",
        ".glb"  => "glb",
        ".gltf" => "gltf",
        ".mtl"  => "mtl",
        ".zip" or ".rar" or ".7z" => "archive",
        _ => "other",
    };

    private static async Task<bool> IsAdminAsync(HttpContext httpContext, UserRepository userRepo)
    {
        var microsoftId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? httpContext.User.FindFirstValue("oid");
        if (microsoftId is null) return false;
        var user = await userRepo.GetByMicrosoftIdAsync(microsoftId);
        return user?.Role == 2;
    }
}
