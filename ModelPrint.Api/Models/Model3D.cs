using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace ModelPrint.Api.Models;

public class Model3D
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string ThumbnailPath { get; set; } = "";
    public string Category { get; set; } = "";
    public string AuthorId { get; set; } = "";
    public string AuthorName { get; set; } = "";
    public int Downloads { get; set; }
    public int Likes { get; set; }
    public bool IsFavorite { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public bool IsExploreModel { get; set; }

    // Package import fields
    public string? PackagePath { get; set; }
    public string? SourceUrl { get; set; }
    public string Status { get; set; } = "ready";

    [JsonIgnore]
    public ICollection<ModelTag> ModelTags { get; set; } = [];
    public ICollection<ModelImage> Images { get; set; } = [];
    public ICollection<ModelPart> Parts { get; set; } = [];

    // Populated from ModelTags after query — not persisted
    [NotMapped]
    public List<string> Tags { get; set; } = [];
}

public class ModelImage
{
    public int Id { get; set; }
    public int ModelId { get; set; }
    public string ImagePath { get; set; } = "";
    public int SortOrder { get; set; }
    public string ImageType { get; set; } = "generated"; // "source" | "generated"
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [JsonIgnore]
    public Model3D? Model { get; set; }
}

public class ModelPart
{
    public int Id { get; set; }
    public int ModelId { get; set; }
    public string FileName { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string? PreviewImagePath { get; set; }
    public int TriangleCount { get; set; }
    public float Width { get; set; }
    public float Height { get; set; }
    public float Depth { get; set; }
    public int SortOrder { get; set; }

    [JsonIgnore]
    public Model3D? Model { get; set; }
}

public class Tag
{
    public int Id { get; set; }
    public string Name { get; set; } = "";

    [JsonIgnore]
    public ICollection<ModelTag> ModelTags { get; set; } = [];
}

public class ModelTag
{
    public int ModelId { get; set; }
    public int TagId { get; set; }

    [JsonIgnore]
    public Model3D? Model { get; set; }
    [JsonIgnore]
    public Tag? TagEntity { get; set; }
}

public class CreateModelRequest
{
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string Tags { get; set; } = "";
}

public class UpdateModelRequest
{
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string Tags { get; set; } = "";
}
