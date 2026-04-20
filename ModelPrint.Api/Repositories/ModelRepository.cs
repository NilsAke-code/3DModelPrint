using Microsoft.EntityFrameworkCore;
using ModelPrint.Api.Data;
using ModelPrint.Api.Models;

namespace ModelPrint.Api.Repositories;

public class ModelRepository(ModelPrintDbContext db)
{
    public async Task<List<Model3D>> GetAllAsync(string? search, string? category, string? tag, string sort = "newest")
    {
        var query = db.Models
            .Include(m => m.ModelTags).ThenInclude(mt => mt.TagEntity)
            .Include(m => m.Images.OrderBy(i => i.SortOrder))
            .Where(m => m.FilePath != "")   // exclude incomplete seed records awaiting client generation
            .AsQueryable();

        if (!string.IsNullOrEmpty(search))
            query = query.Where(m => m.Title.Contains(search) || m.Description.Contains(search));
        if (!string.IsNullOrEmpty(category))
            query = query.Where(m => m.Category == category);
        if (!string.IsNullOrEmpty(tag))
            query = query.Where(m => m.ModelTags.Any(mt => mt.TagEntity!.Name == tag));

        query = sort switch
        {
            "downloads" => query.OrderByDescending(m => m.Downloads),
            "likes"     => query.OrderByDescending(m => m.Likes),
            _           => query.OrderByDescending(m => m.CreatedAt),
        };

        var models = await query.ToListAsync();
        foreach (var m in models)
            m.Tags = m.ModelTags.Select(mt => mt.TagEntity!.Name).ToList();
        return models;
    }

    public async Task<Model3D?> GetByIdAsync(int id)
    {
        var model = await db.Models
            .Include(m => m.ModelTags).ThenInclude(mt => mt.TagEntity)
            .Include(m => m.Images.OrderBy(i => i.SortOrder))
            .FirstOrDefaultAsync(m => m.Id == id);
        if (model is not null)
            model.Tags = model.ModelTags.Select(mt => mt.TagEntity!.Name).ToList();
        return model;
    }

    public async Task<int> CreateAsync(Model3D model)
    {
        model.CreatedAt = DateTime.UtcNow;
        model.UpdatedAt = DateTime.UtcNow;
        db.Models.Add(model);
        await db.SaveChangesAsync();
        await SetTagsAsync(model.Id, model.Tags);
        return model.Id;
    }

    public async Task UpdateAsync(int id, UpdateModelRequest request)
    {
        var model = await db.Models.FindAsync(id);
        if (model is null) return;
        model.Title = request.Title;
        model.Description = request.Description;
        model.Category = request.Category;
        model.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var tags = request.Tags
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();
        await SetTagsAsync(id, tags);
    }

    public async Task DeleteAsync(int id)
    {
        var model = await db.Models.FindAsync(id);
        if (model is not null)
        {
            db.Models.Remove(model);
            await db.SaveChangesAsync();
        }
    }

    public async Task IncrementDownloadsAsync(int id, int? userId = null)
    {
        await db.Models.Where(m => m.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.Downloads, m => m.Downloads + 1));
        if (userId.HasValue)
        {
            db.DownloadHistories.Add(new DownloadHistory
            {
                ModelId = id, UserId = userId.Value, DownloadedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
    }

    public async Task IncrementLikesAsync(int id) =>
        await db.Models.Where(m => m.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.Likes, m => m.Likes + 1));

    public async Task AddImageAsync(int modelId, string imagePath, int sortOrder)
    {
        db.ModelImages.Add(new ModelImage
        {
            ModelId = modelId, ImagePath = imagePath,
            SortOrder = sortOrder, CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    public async Task ReplaceAllImagesAsync(int modelId, IEnumerable<(string ImagePath, int SortOrder)> images)
    {
        await db.ModelImages.Where(i => i.ModelId == modelId).ExecuteDeleteAsync();
        db.ModelImages.AddRange(images.Select(i => new ModelImage
        {
            ModelId = modelId, ImagePath = i.ImagePath,
            SortOrder = i.SortOrder, CreatedAt = DateTime.UtcNow
        }));
        await db.SaveChangesAsync();
    }

    public async Task<List<Model3D>> GetPendingSeedsAsync()
    {
        var models = await db.Models
            .Where(m => m.FilePath == "")
            .OrderBy(m => m.Id)
            .ToListAsync();
        return models;
    }

    public async Task UpdateFilePathAsync(int id, string filePath)
    {
        await db.Models.Where(m => m.Id == id)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.FilePath, filePath)
                .SetProperty(m => m.UpdatedAt, DateTime.UtcNow));
    }

    public async Task<bool> IsIncompleteSeedException(int id) =>
        await db.Models.AnyAsync(m => m.Id == id && m.FilePath == "");

    public Task<bool> ExistsAsync(int id) =>
        db.Models.AnyAsync(m => m.Id == id);

    private async Task SetTagsAsync(int modelId, List<string> tagNames)
    {
        await db.ModelTags.Where(mt => mt.ModelId == modelId).ExecuteDeleteAsync();
        foreach (var name in tagNames.Where(n => !string.IsNullOrWhiteSpace(n)))
        {
            var tag = await db.Tags.FirstOrDefaultAsync(t => t.Name == name);
            if (tag is null)
            {
                tag = new Tag { Name = name };
                db.Tags.Add(tag);
                await db.SaveChangesAsync();
            }
            if (!await db.ModelTags.AnyAsync(mt => mt.ModelId == modelId && mt.TagId == tag.Id))
                db.ModelTags.Add(new ModelTag { ModelId = modelId, TagId = tag.Id });
        }
        await db.SaveChangesAsync();
    }
}
