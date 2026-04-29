using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ModelPrint.Api.Data;
using ModelPrint.Api.Endpoints;
using ModelPrint.Api.Repositories;
using ModelPrint.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// EF Core + SQL Server
builder.Services.AddDbContext<ModelPrintDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("modelprintdb")));

// Authentication — Microsoft Entra ID / MSAL JWT
var clientId = builder.Configuration["AzureAd:ClientId"];
var isAuthConfigured = !string.IsNullOrEmpty(clientId) && !clientId.Contains("YOUR_");
if (isAuthConfigured)
{
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.Authority = "https://login.microsoftonline.com/common/v2.0";
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidAudiences = [clientId!, $"api://{clientId}"],
                ValidateIssuer = false,
                ValidateAudience = true,
                ValidateLifetime = true,
            };
        });
}
else
{
    builder.Services.AddAuthentication();
}
builder.Services.AddAuthorization();

builder.Services.AddScoped<ModelRepository>();
builder.Services.AddScoped<TagRepository>();
builder.Services.AddScoped<UserRepository>();
builder.Services.AddSingleton<FileStorageService>();
builder.Services.AddHttpClient("import", client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("3DModelPrint-Import/1.0");
});

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5174")
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Approval gate: block pending/rejected users from non-self API endpoints.
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "";
    if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)
        && ctx.User.Identity?.IsAuthenticated == true
        && !path.StartsWith("/api/users/me", StringComparison.OrdinalIgnoreCase))
    {
        var msId = ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                   ?? ctx.User.FindFirst("oid")?.Value;
        if (msId is not null)
        {
            var userRepo = ctx.RequestServices.GetRequiredService<UserRepository>();
            var current = await userRepo.GetByMicrosoftIdAsync(msId);
            if (current is not null && current.Status != 1)
            {
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                await ctx.Response.WriteAsJsonAsync(new { reason = "pending_approval", status = current.Status });
                return;
            }
        }
    }
    await next();
});

// Migrate DB on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ModelPrintDbContext>();
    await db.Database.MigrateAsync();
}

// Serve uploaded files at /uploads/*
var fileStorage = app.Services.GetRequiredService<FileStorageService>();
var mimeProvider = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
mimeProvider.Mappings[".stl"] = "application/octet-stream";
mimeProvider.Mappings[".3mf"] = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(
        fileStorage.GetFullPath("")),
    RequestPath = "/uploads",
    ContentTypeProvider = mimeProvider,
    ServeUnknownFileTypes = true,
    DefaultContentType = "application/octet-stream"
});

app.MapModelEndpoints();
app.MapTagEndpoints();
app.MapCategoryEndpoints();
app.MapUserEndpoints();
app.MapImportEndpoints();

app.Run();
