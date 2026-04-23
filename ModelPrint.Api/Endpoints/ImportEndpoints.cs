using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using ModelPrint.Api.Data;
using ModelPrint.Api.Models;
using ModelPrint.Api.Repositories;
using ModelPrint.Api.Services;

namespace ModelPrint.Api.Endpoints;

public static class ImportEndpoints
{
    private static readonly HashSet<string> ModelExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".stl", ".obj", ".glb", ".gltf" };

    private static readonly HashSet<string> TextureExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga" };

    private static readonly HashSet<string> SourceImageExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".webp", ".gif" };

    private const long MaxDownloadBytes  = 200L * 1024 * 1024;
    private const long MaxExtractedBytes = 400L * 1024 * 1024;
    private const long MaxSourceImageBytes = 10L * 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOpts =
        new() { PropertyNameCaseInsensitive = true };

    public static void MapImportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/import").RequireAuthorization();

        // ── Create session ────────────────────────────────────────────────────
        group.MapPost("/session", async (
            ImportSessionRequest body,
            HttpContext ctx,
            IHttpClientFactory httpClientFactory,
            FileStorageService fileStorage,
            IConfiguration config) =>
        {
            var userId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? ctx.User.FindFirstValue("oid");
            if (userId is null) return Results.Unauthorized();

            if (!Uri.TryCreate(body.Url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != "https" && uri.Scheme != "http"))
                return Results.BadRequest(new { error = "invalid_url" });

            var allowed = config.GetSection("Import:AllowedDomains").Get<string[]>() ?? [];
            if (!allowed.Contains(uri.Host, StringComparer.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = "domain_not_allowed" });

            var sessionId = Guid.NewGuid().ToString("N");
            var client = httpClientFactory.CreateClient("import");

            try
            {
                using var response = await client.GetAsync(body.Url, HttpCompletionOption.ResponseHeadersRead);
                if (!response.IsSuccessStatusCode)
                    return Results.BadRequest(new { error = "url_fetch_failed" });

                var rawExt = Path.GetExtension(uri.LocalPath).ToLowerInvariant();
                var files = new List<ImportFileEntry>();

                // ── ZIP archive ───────────────────────────────────────────────
                if (rawExt == ".zip" || response.Content.Headers.ContentType?.MediaType == "application/zip")
                {
                    await using var limited = new LimitedStream(
                        await response.Content.ReadAsStreamAsync(), MaxDownloadBytes);
                    var zipBytes = await ReadAllAsync(limited);

                    // Save original ZIP
                    var zipFileName = Path.GetFileName(uri.LocalPath);
                    if (string.IsNullOrWhiteSpace(zipFileName)) zipFileName = "archive.zip";
                    await fileStorage.SaveTempFileAsync(sessionId, zipFileName,
                        new MemoryStream(zipBytes), "original");
                    files.Add(new ImportFileEntry(zipFileName, $"original/{zipFileName}", "archive"));

                    // Validate and extract all entries
                    using var zip = new System.IO.Compression.ZipArchive(
                        new MemoryStream(zipBytes), System.IO.Compression.ZipArchiveMode.Read);

                    long totalExtracted = 0;
                    foreach (var entry in zip.Entries)
                    {
                        if (entry.Length == 0) continue; // directory entries
                        totalExtracted += entry.Length;
                        if (totalExtracted > MaxExtractedBytes)
                            return Results.BadRequest(new { error = "extracted_size_exceeded" });
                        if (entry.FullName.Contains(".."))
                            return Results.BadRequest(new { error = "invalid_archive" });
                    }

                    foreach (var entry in zip.Entries)
                    {
                        if (entry.Length == 0) continue;
                        var safeRelPath = entry.FullName.TrimStart('/').Replace('\\', '/');
                        await using var entryStream = entry.Open();
                        await fileStorage.SaveTempFileAsync(sessionId, safeRelPath, entryStream, "extracted");
                        var role = AssignRole(Path.GetExtension(safeRelPath));
                        files.Add(new ImportFileEntry(Path.GetFileName(safeRelPath),
                            $"extracted/{safeRelPath}", role));
                    }

                    // Detect primary type from archive contents
                    var primaryEntry = zip.Entries.FirstOrDefault(e =>
                            e.Name.EndsWith(".glb", StringComparison.OrdinalIgnoreCase) ||
                            e.Name.EndsWith(".gltf", StringComparison.OrdinalIgnoreCase))
                        ?? zip.Entries.FirstOrDefault(e =>
                            e.Name.EndsWith(".obj", StringComparison.OrdinalIgnoreCase))
                        ?? zip.Entries.FirstOrDefault(e =>
                            e.Name.EndsWith(".stl", StringComparison.OrdinalIgnoreCase));
                    var detectedType = primaryEntry is not null
                        ? Path.GetExtension(primaryEntry.Name).TrimStart('.').ToLowerInvariant()
                        : "zip";

                    // Download source images best-effort
                    await DownloadSourceImagesAsync(
                        client, fileStorage, sessionId, body.SourceImages, files);

                    var meta = new ImportSessionMeta(sessionId, userId, detectedType,
                        DateTime.UtcNow.AddMinutes(30), files);
                    await SaveSessionMeta(fileStorage, sessionId, meta);

                    return Results.Ok(new
                    {
                        sessionId,
                        detectedType = meta.DetectedType,
                        files,
                        expiresAt = meta.ExpiresAt,
                    });
                }

                // ── Direct model file ────────────────────────────────────────
                var ext = rawExt;
                if (!ModelExtensions.Contains(ext))
                    return Results.BadRequest(new { error = "unsupported_format" });

                var fileName = Path.GetFileName(uri.LocalPath);
                if (string.IsNullOrWhiteSpace(fileName)) fileName = $"model{ext}";

                await using var limitedDirect = new LimitedStream(
                    await response.Content.ReadAsStreamAsync(), MaxDownloadBytes);
                await fileStorage.SaveTempFileAsync(sessionId, fileName, limitedDirect, "extracted");

                var role2 = AssignRole(ext);
                files.Add(new ImportFileEntry(fileName, $"extracted/{fileName}", role2));

                await DownloadSourceImagesAsync(
                    client, fileStorage, sessionId, body.SourceImages, files);

                var directMeta = new ImportSessionMeta(sessionId, userId,
                    ext.TrimStart('.'), DateTime.UtcNow.AddMinutes(30), files);
                await SaveSessionMeta(fileStorage, sessionId, directMeta);

                return Results.Ok(new
                {
                    sessionId,
                    detectedType = directMeta.DetectedType,
                    files,
                    expiresAt = directMeta.ExpiresAt,
                });
            }
            catch (LimitExceededException)
            {
                fileStorage.DeleteTempSession(sessionId);
                return Results.BadRequest(new { error = "file_too_large" });
            }
            catch
            {
                fileStorage.DeleteTempSession(sessionId);
                return Results.BadRequest(new { error = "url_fetch_failed" });
            }
        });

        // ── Delete session ────────────────────────────────────────────────────
        group.MapDelete("/session/{sessionId}", (
            string sessionId, HttpContext ctx, FileStorageService fileStorage) =>
        {
            var userId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? ctx.User.FindFirstValue("oid");

            var meta = ReadSessionMeta(fileStorage, sessionId);
            if (meta is null) return Results.NotFound();
            if (meta.OwnerId != userId) return Results.Forbid();

            fileStorage.DeleteTempSession(sessionId);
            return Results.NoContent();
        });

        // ── Get session metadata ──────────────────────────────────────────────
        group.MapGet("/session/{sessionId}", (
            string sessionId, HttpContext ctx, FileStorageService fileStorage) =>
        {
            var userId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? ctx.User.FindFirstValue("oid");

            var meta = ReadSessionMeta(fileStorage, sessionId);
            if (meta is null) return Results.NotFound();
            if (meta.OwnerId != userId) return Results.Forbid();
            if (meta.ExpiresAt < DateTime.UtcNow) return Results.NotFound();

            return Results.Ok(new
            {
                sessionId = meta.SessionId,
                detectedType = meta.DetectedType,
                files = meta.Files,
                expiresAt = meta.ExpiresAt,
            });
        });

        // ── Serve session file ────────────────────────────────────────────────
        group.MapGet("/session/{sessionId}/file/{*path}", (
            string sessionId, string path, HttpContext ctx, FileStorageService fileStorage) =>
        {
            var userId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? ctx.User.FindFirstValue("oid");

            var meta = ReadSessionMeta(fileStorage, sessionId);
            if (meta is null) return Results.NotFound();
            if (meta.OwnerId != userId) return Results.Forbid();
            if (meta.ExpiresAt < DateTime.UtcNow) return Results.NotFound();

            if (path.Contains("..") || Path.IsPathRooted(path))
                return Results.BadRequest(new { error = "invalid_path" });

            var fullPath = Path.Combine(fileStorage.GetTempSessionDirectory(sessionId), path);
            if (!File.Exists(fullPath)) return Results.NotFound();

            var fileExt = Path.GetExtension(fullPath).ToLowerInvariant();
            var contentType = fileExt switch
            {
                ".stl"            => "model/stl",
                ".obj"            => "model/obj",
                ".glb"            => "model/gltf-binary",
                ".gltf"           => "model/gltf+json",
                ".mtl"            => "text/plain",
                ".png"            => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp"           => "image/webp",
                _                 => "application/octet-stream",
            };

            return Results.File(fullPath, contentType, Path.GetFileName(fullPath));
        });

        // ── Save import package ───────────────────────────────────────────────
        group.MapPost("/package", async (
            HttpRequest request,
            HttpContext ctx,
            FileStorageService fileStorage,
            ModelRepository repo,
            ModelPrintDbContext db) =>
        {
            var userId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? ctx.User.FindFirstValue("oid");
            if (userId is null) return Results.Unauthorized();
            var authorName = ctx.User.FindFirstValue("name")
                ?? ctx.User.FindFirstValue(ClaimTypes.Name)
                ?? "Unknown";

            var form = await request.ReadFormAsync();
            var sessionId = form["sessionId"].ToString();
            if (string.IsNullOrWhiteSpace(sessionId))
                return Results.BadRequest(new { error = "missing_session_id" });

            var meta = ReadSessionMeta(fileStorage, sessionId);
            if (meta is null) return Results.BadRequest(new { error = "session_not_found" });
            if (meta.OwnerId != userId) return Results.Forbid();
            if (meta.ExpiresAt < DateTime.UtcNow) return Results.BadRequest(new { error = "session_expired" });

            var title = form["title"].ToString();
            var description = form["description"].ToString();
            var category = form["category"].ToString();
            var sourceUrl = form["sourceUrl"].ToString();
            var tags = form["tags"].ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList();

            // Collect part metadata from form
            var partInputs = new List<PartInput>();
            for (int i = 0; ; i++)
            {
                var relPath = form[$"Part_{i}_RelativePath"].ToString();
                if (string.IsNullOrWhiteSpace(relPath)) break;

                int.TryParse(form[$"Part_{i}_TriangleCount"].ToString(), out var triCount);
                float.TryParse(form[$"Part_{i}_Width"].ToString(), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var width);
                float.TryParse(form[$"Part_{i}_Height"].ToString(), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var height);
                float.TryParse(form[$"Part_{i}_Depth"].ToString(), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var depth);
                var previewFile = form.Files.GetFile($"Part_{i}_Preview");

                partInputs.Add(new PartInput(relPath, triCount, width, height, depth, previewFile));
            }

            // 1. Determine first STL name for backward-compat FilePath (before we know modelId)
            var firstPartRelPath = partInputs.Count > 0 ? partInputs[0].RelativePath : "";

            // 2. Create Model3D with Status="pending" so it's hidden from library until finalized
            var model = new Model3D
            {
                Title = title,
                Description = description,
                Category = category,
                FilePath = "",          // set after we know modelId
                ThumbnailPath = "",
                AuthorId = userId,
                AuthorName = authorName,
                SourceUrl = string.IsNullOrWhiteSpace(sourceUrl) ? null : sourceUrl,
                Status = "pending",
                Tags = tags,
            };
            var modelId = await repo.CreateAsync(model);

            try
            {
                // 3. Create package directories
                fileStorage.CreatePackageDirectories(modelId);
                var tempRoot = fileStorage.GetTempSessionDirectory(sessionId);
                var packageRoot = fileStorage.GetPackageDirectory(modelId);

                // 4. Copy original/, extracted/, source-media/ from temp to package
                foreach (var subfolder in new[] { "original", "extracted", "source-media" })
                {
                    var src = Path.Combine(tempRoot, subfolder);
                    if (Directory.Exists(src))
                        CopyDirectory(src, Path.Combine(packageRoot, subfolder));
                }

                // 5. Save generated preview blobs and collect ModelPart rows
                var parts = new List<ModelPart>();
                for (int i = 0; i < partInputs.Count; i++)
                {
                    var input = partInputs[i];
                    string? previewRelPath = null;

                    if (input.PreviewFile is not null)
                    {
                        var previewFileName =
                            Path.GetFileNameWithoutExtension(Path.GetFileName(input.RelativePath)) + ".webp";
                        await using var ps = input.PreviewFile.OpenReadStream();
                        await fileStorage.SavePackagePreviewAsync(modelId, previewFileName, ps);
                        previewRelPath = $"packages/{modelId}/generated/previews/{previewFileName}";
                    }

                    // RelativePath in session is like "extracted/Part1.stl"
                    var partFilePath = $"packages/{modelId}/{input.RelativePath}";
                    parts.Add(new ModelPart
                    {
                        ModelId = modelId,
                        FileName = Path.GetFileName(input.RelativePath),
                        FilePath = partFilePath,
                        PreviewImagePath = previewRelPath,
                        TriangleCount = input.TriangleCount,
                        Width = input.Width,
                        Height = input.Height,
                        Depth = input.Depth,
                        SortOrder = i,
                    });
                }
                await repo.AddPartsAsync(parts);

                // 6. Add ModelImage rows for source images (sortOrder 0,1,2...) and generated previews (100+)
                var sourceFiles = meta.Files.Where(f => f.Role == "source-image").ToList();
                for (int i = 0; i < sourceFiles.Count; i++)
                {
                    var destPath = $"packages/{modelId}/{sourceFiles[i].RelativePath}";
                    await repo.AddImageAsync(modelId, destPath, i, "source");
                }
                for (int i = 0; i < parts.Count; i++)
                {
                    if (parts[i].PreviewImagePath is not null)
                        await repo.AddImageAsync(modelId, parts[i].PreviewImagePath!, 100 + i, "stl-preview");
                }

                // 7. Finalize: set FilePath + PackagePath + Status="ready"
                var filePath = string.IsNullOrWhiteSpace(firstPartRelPath)
                    ? $"packages/{modelId}/extracted"
                    : $"packages/{modelId}/{firstPartRelPath}";
                await repo.FinalizePackageAsync(modelId, filePath, $"packages/{modelId}");

                // 8. Cleanup temp session
                fileStorage.DeleteTempSession(sessionId);

                return Results.Created($"/api/models/{modelId}", new { id = modelId });
            }
            catch (Exception ex)
            {
                // Mark as failed — don't expose internals
                try
                {
                    await db.Models.Where(m => m.Id == modelId)
                        .ExecuteUpdateAsync(s => s.SetProperty(m => m.Status, "import_failed"));
                }
                catch { /* best-effort status update */ }

                return Results.Problem(
                    title: "Package save failed",
                    detail: ex.Message,
                    statusCode: 500);
            }
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static string AssignRole(string ext) => ext.ToLowerInvariant() switch
    {
        ".stl"                          => "stl",
        ".obj"                          => "obj",
        ".glb"                          => "glb",
        ".gltf"                         => "gltf",
        ".mtl"                          => "mtl",
        ".png" or ".jpg" or ".jpeg"
            or ".webp" or ".bmp"
            or ".tga"                   => "texture",
        ".zip" or ".rar" or ".7z"       => "archive",
        ".pdf" or ".txt" or ".md"
            or ".readme"                => "document",
        _                               => "other",
    };

    private static async Task DownloadSourceImagesAsync(
        HttpClient client,
        FileStorageService fileStorage,
        string sessionId,
        List<string>? sourceImageUrls,
        List<ImportFileEntry> files)
    {
        if (sourceImageUrls is null or { Count: 0 }) return;

        int idx = 0;
        foreach (var imgUrl in sourceImageUrls)
        {
            try
            {
                if (!Uri.TryCreate(imgUrl, UriKind.Absolute, out var imgUri)) continue;
                using var imgResp = await client.GetAsync(imgUrl, HttpCompletionOption.ResponseHeadersRead);
                if (!imgResp.IsSuccessStatusCode) continue;

                var imgExt = Path.GetExtension(imgUri.LocalPath).ToLowerInvariant();
                if (!SourceImageExtensions.Contains(imgExt)) imgExt = ".jpg";

                var imgFileName = $"{idx}{imgExt}";
                await using var limited = new LimitedStream(
                    await imgResp.Content.ReadAsStreamAsync(), MaxSourceImageBytes);
                await fileStorage.SaveTempFileAsync(sessionId, imgFileName, limited, "source-media");
                files.Add(new ImportFileEntry(imgFileName, $"source-media/{imgFileName}", "source-image"));
                idx++;
            }
            catch { /* best-effort — never fail the session */ }
        }
    }

    private static void CopyDirectory(string sourceDir, string destDir)
    {
        Directory.CreateDirectory(destDir);
        foreach (var file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDir, file);
            var destFile = Path.Combine(destDir, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(destFile)!);
            File.Copy(file, destFile, overwrite: true);
        }
    }

    private static ImportSessionMeta? ReadSessionMeta(FileStorageService fs, string sessionId)
    {
        var path = Path.Combine(fs.GetTempSessionDirectory(sessionId), "session.json");
        if (!File.Exists(path)) return null;
        return JsonSerializer.Deserialize<ImportSessionMeta>(File.ReadAllText(path), JsonOpts);
    }

    private static async Task SaveSessionMeta(FileStorageService fs, string sessionId, ImportSessionMeta meta)
    {
        var json = JsonSerializer.Serialize(meta);
        using var ms = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json));
        await fs.SaveTempFileAsync(sessionId, "session.json", ms);
    }

    private static async Task<byte[]> ReadAllAsync(Stream stream)
    {
        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms);
        return ms.ToArray();
    }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

record ImportSessionRequest(string Url, List<string>? SourceImages);

record ImportFileEntry(
    [property: JsonPropertyName("name")]         string Name,
    [property: JsonPropertyName("relativePath")] string RelativePath,
    [property: JsonPropertyName("role")]         string Role);

record ImportSessionMeta(
    string SessionId,
    string OwnerId,
    string DetectedType,
    DateTime ExpiresAt,
    List<ImportFileEntry> Files);

record PartInput(
    string RelativePath,
    int TriangleCount,
    float Width,
    float Height,
    float Depth,
    IFormFile? PreviewFile);

// ── Stream helpers ────────────────────────────────────────────────────────────

class LimitedStream(Stream inner, long maxBytes) : Stream
{
    private long _read;

    public override bool CanRead  => true;
    public override bool CanSeek  => false;
    public override bool CanWrite => false;
    public override long Length   => throw new NotSupportedException();
    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override int Read(byte[] buffer, int offset, int count)
    {
        _read += count;
        if (_read > maxBytes) throw new LimitExceededException();
        return inner.Read(buffer, offset, count);
    }

    public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct)
    {
        var n = await inner.ReadAsync(buffer, offset, count, ct);
        _read += n;
        if (_read > maxBytes) throw new LimitExceededException();
        return n;
    }
}

class LimitExceededException : Exception;
