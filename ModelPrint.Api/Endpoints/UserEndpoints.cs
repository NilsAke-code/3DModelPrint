using System.Security.Claims;
using ModelPrint.Api.Models;
using ModelPrint.Api.Repositories;
using ModelPrint.Api.Services;

namespace ModelPrint.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this WebApplication app)
    {
        app.MapGet("/api/users/me", async (HttpContext httpContext, UserRepository userRepo, ILogger<Program> logger) =>
        {
            var (microsoftId, email, displayName) = ExtractUserClaims(httpContext);
            logger.LogInformation("GET /api/users/me — MicrosoftId: {MsId}, Email: {Email}, Name: {Name}",
                microsoftId, email, displayName);

            if (microsoftId is null) return Results.Unauthorized();

            var user = await userRepo.GetOrCreateAsync(microsoftId, email, displayName);
            return Results.Ok(new UserResponse
            {
                Id = user.Id, Email = user.Email,
                DisplayName = user.DisplayName, Role = user.Role, Status = user.Status,
                ProfilePictureUrl = user.ProfilePicturePath is not null
                    ? $"/uploads/{user.ProfilePicturePath}"
                    : null,
            });
        }).RequireAuthorization();

        app.MapPut("/api/users/me", async (UpdateProfileRequest request, HttpContext httpContext, UserRepository userRepo) =>
        {
            var (microsoftId, _, _) = ExtractUserClaims(httpContext);
            if (microsoftId is null) return Results.Unauthorized();

            var user = await userRepo.GetByMicrosoftIdAsync(microsoftId);
            if (user is null) return Results.NotFound();

            var displayName = request.DisplayName.Trim();
            if (string.IsNullOrEmpty(displayName)) return Results.BadRequest("Display name cannot be empty.");

            await userRepo.UpdateProfileAsync(user.Id, displayName);
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPost("/api/users/me/avatar", async (IFormFile file, HttpContext httpContext, UserRepository userRepo, FileStorageService fileStorage) =>
        {
            var (microsoftId, _, _) = ExtractUserClaims(httpContext);
            if (microsoftId is null) return Results.Unauthorized();

            var user = await userRepo.GetByMicrosoftIdAsync(microsoftId);
            if (user is null) return Results.NotFound();

            if (file.Length > 5 * 1024 * 1024) return Results.BadRequest("Avatar must be under 5 MB.");

            if (!string.IsNullOrEmpty(user.ProfilePicturePath))
                fileStorage.DeleteFile(user.ProfilePicturePath);

            var relativePath = await fileStorage.SaveAvatarAsync(user.Id, file);
            await userRepo.UpdateAvatarAsync(user.Id, relativePath);

            return Results.Ok(new { url = $"/uploads/{relativePath}" });
        }).RequireAuthorization().DisableAntiforgery();

        var admin = app.MapGroup("/api/admin").RequireAuthorization();

        admin.MapGet("/stats", async (HttpContext httpContext, UserRepository userRepo) =>
        {
            if (!await IsAdmin(httpContext, userRepo)) return Results.Forbid();
            var stats = await userRepo.GetStatsAsync();
            return Results.Ok(stats);
        });

        admin.MapGet("/users", async (HttpContext httpContext, UserRepository userRepo) =>
        {
            if (!await IsAdmin(httpContext, userRepo)) return Results.Forbid();
            var users = await userRepo.GetAllAsync();
            return Results.Ok(users.Select(u => new UserResponse
            {
                Id = u.Id, Email = u.Email, DisplayName = u.DisplayName, Role = u.Role, Status = u.Status
            }));
        });

        admin.MapPost("/users/{id:int}/approve", async (int id, HttpContext httpContext, UserRepository userRepo) =>
        {
            if (!await IsAdmin(httpContext, userRepo)) return Results.Forbid();
            await userRepo.UpdateStatusAsync(id, 1);
            return Results.NoContent();
        });

        admin.MapPost("/users/{id:int}/reject", async (int id, HttpContext httpContext, UserRepository userRepo) =>
        {
            if (!await IsAdmin(httpContext, userRepo)) return Results.Forbid();
            await userRepo.UpdateStatusAsync(id, 2);
            return Results.NoContent();
        });

        admin.MapPut("/users/{id:int}/role", async (int id, UpdateRoleRequest request, HttpContext httpContext, UserRepository userRepo) =>
        {
            if (!await IsAdmin(httpContext, userRepo)) return Results.Forbid();
            if (request.Role is < 0 or > 2) return Results.BadRequest("Role must be 0, 1, or 2.");

            var microsoftId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? httpContext.User.FindFirstValue("oid");
            var currentUser = await userRepo.GetByMicrosoftIdAsync(microsoftId!);
            if (currentUser?.Id == id) return Results.BadRequest("Cannot change your own role.");

            await userRepo.UpdateRoleAsync(id, request.Role);
            return Results.NoContent();
        });

        admin.MapGet("/models", async (string? search, HttpContext httpContext, UserRepository userRepo, ModelRepository modelRepo) =>
        {
            if (!await IsAdmin(httpContext, userRepo)) return Results.Forbid();
            var models = await modelRepo.GetAllAsync(search, null, null, "newest");
            return Results.Ok(models);
        });

        admin.MapDelete("/models/{id:int}", async (int id, HttpContext httpContext, UserRepository userRepo, ModelRepository modelRepo, FileStorageService fileStorage) =>
        {
            if (!await IsAdmin(httpContext, userRepo)) return Results.Forbid();
            var model = await modelRepo.GetByIdAsync(id);
            if (model is null) return Results.NotFound();
            if (!string.IsNullOrEmpty(model.FilePath)) fileStorage.DeleteFile(model.FilePath);
            if (!string.IsNullOrEmpty(model.ThumbnailPath)) fileStorage.DeleteFile(model.ThumbnailPath);
            await modelRepo.DeleteAsync(id);
            return Results.NoContent();
        });
    }

    private static (string? microsoftId, string email, string displayName) ExtractUserClaims(HttpContext httpContext)
    {
        var user = httpContext.User;
        var microsoftId = user.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? user.FindFirstValue("oid");
        var email = user.FindFirstValue(ClaimTypes.Email)
            ?? user.FindFirstValue("preferred_username")
            ?? "";
        var displayName = user.FindFirstValue("name")
            ?? user.FindFirstValue(ClaimTypes.Name)
            ?? "Unknown";
        return (microsoftId, email, displayName);
    }

    private static async Task<bool> IsAdmin(HttpContext httpContext, UserRepository userRepo)
    {
        var microsoftId = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? httpContext.User.FindFirstValue("oid");
        if (microsoftId is null) return false;
        var user = await userRepo.GetByMicrosoftIdAsync(microsoftId);
        return user?.Role == 2;
    }
}
