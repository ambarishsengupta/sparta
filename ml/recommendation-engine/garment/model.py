"""Garment CNN version 1 (LLD 7.7): three 3x3 conv blocks (16, 32, 64; ReLU; 2x2 max pool after the first two), global
average pooling, a 32-unit dense layer with ReLU (the 32 shape numbers) and a 10-way output. 25,706 weights.

GarmentCNN.forward gives (logits, shape) for training; ExportCNN gives (softmax scores, shape) in that order, which is
what the ONNX file returns (outputs "scores" and "shape").
"""
import torch
from torch import nn

OUTPUT_NAMES = ["scores", "shape"]
WEIGHT_COUNT = 25706      # 160 + 4,640 + 18,496 (convolutions) + 2,080 + 330 (dense layers)

class GarmentCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),     # 28 -> 14
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),    # 14 -> 7
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1), nn.Flatten())                           # global average pooling -> 64
        self.dense = nn.Sequential(nn.Linear(64, 32), nn.ReLU())
        self.out = nn.Linear(32, 10)

    def forward(self, x):
        shape = self.dense(self.features(x))
        return self.out(shape), shape

class ExportCNN(nn.Module):
    """The inference graph: 10 softmax scores, then the 32 shape numbers."""
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x):
        logits, shape = self.net(x)
        return torch.softmax(logits, dim=1), shape

def weight_count(net):
    return sum(p.numel() for p in net.parameters())
