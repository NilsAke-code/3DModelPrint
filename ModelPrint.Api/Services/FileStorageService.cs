namespace ModelPrint.Api.Services;

public class FileStorageService
{
    private readonly string _uploadPath;

    public FileStorageService(IConfiguration configuration)
    {
        _uploadPath = configuration["FileStorage:UploadPath"]
            ?? Path.Combine(Directory.GetCurrentDirectory(), "uploads");
        Directory.CreateDirectory(Path.Combine(_uploadPath, "models"));
        Directory.CreateDirectory(Path.Combine(_uploadPath, "thumbnails"));
        Directory.CreateDirectory(Path.Combine(_uploadPath, "gallery"));
        Directory.CreateDirectory(Path.Combine(_uploadPath, "temp"));
        Directory.CreateDirectory(Path.Combine(_uploadPath, "packages"));
    }

    // ── Temp session helpers ──────────────────────────────────────────────────

    public string GetTempSessionDirectory(string sessionId) =>
        Path.Combine(_uploadPath, "temp", sessionId);

    /// <summary>
    /// Save a file to the temp session directory, optionally inside a subfolder.
    /// The filename may include path separators to preserve archive structure.
    /// </summary>
    public async Task SaveTempFileAsync(string sessionId, string filename, Stream content, string? subfolder = null)
    {
        var sessionDir = GetTempSessionDirectory(sessionId);
        var baseDir = subfolder is null ? sessionDir : Path.Combine(sessionDir, subfolder);

        var filePath = Path.GetFullPath(Path.Combine(baseDir, filename));
        // Path traversal guard
        if (!filePath.StartsWith(Path.GetFullPath(sessionDir), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Path traversal detected in temp file path.");

        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        await using var stream = new FileStream(filePath, FileMode.Create);
        await content.CopyToAsync(stream);
    }

    public void DeleteTempSession(string sessionId)
    {
        var sessionDir = GetTempSessionDirectory(sessionId);
        if (Directory.Exists(sessionDir))
            Directory.Delete(sessionDir, recursive: true);
    }

    public void PruneExpiredTempSessions(TimeSpan maxAge)
    {
        var tempRoot = Path.Combine(_uploadPath, "temp");
        if (!Directory.Exists(tempRoot)) return;
        var cutoff = DateTime.UtcNow - maxAge;
        foreach (var dir in Directory.GetDirectories(tempRoot))
        {
            if (Directory.GetCreationTimeUtc(dir) < cutoff)
                Directory.Delete(dir, recursive: true);
        }
    }

    // ── Package helpers ───────────────────────────────────────────────────────

    public string GetPackageDirectory(int modelId) =>
        Path.Combine(_uploadPath, "packages", modelId.ToString());

    public void CreatePackageDirectories(int modelId)
    {
        var root = GetPackageDirectory(modelId);
        Directory.CreateDirectory(Path.Combine(root, "original"));
        Directory.CreateDirectory(Path.Combine(root, "extracted"));
        Directory.CreateDirectory(Path.Combine(root, "source-media"));
        Directory.CreateDirectory(Path.Combine(root, "generated", "previews"));
    }

    public async Task SavePackagePreviewAsync(int modelId, string filename, Stream stream)
    {
        var dir = Path.Combine(GetPackageDirectory(modelId), "generated", "previews");
        Directory.CreateDirectory(dir);
        var filePath = Path.Combine(dir, filename);
        await using var fs = new FileStream(filePath, FileMode.Create);
        await stream.CopyToAsync(fs);
    }

    public string GetPackageRelativePath(int modelId, string subfolder, string filename) =>
        $"packages/{modelId}/{subfolder}/{filename}";

    // ── Permanent model / gallery helpers ─────────────────────────────────────

    public async Task<string> SaveModelFileAsync(IFormFile file)
    {
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(_uploadPath, "models", fileName);
        await using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return $"models/{fileName}";
    }

    public async Task<string> SaveGalleryImageAsync(IFormFile file)
    {
        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(_uploadPath, "gallery", fileName);
        await using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return $"gallery/{fileName}";
    }

    public string GetFullPath(string relativePath) =>
        Path.Combine(_uploadPath, relativePath);

    public void DeleteFile(string relativePath)
    {
        var fullPath = GetFullPath(relativePath);
        if (File.Exists(fullPath)) File.Delete(fullPath);
    }
}
