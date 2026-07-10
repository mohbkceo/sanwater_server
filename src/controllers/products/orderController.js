const Order = require( "../../models/order.model");

 const placeOrder = async (req, res) => {
  try {
    const {
      productId,
      serialNumber,
      productName,
      fullName,
      phoneNumber,
      address,
      quantity,
      subtotal,
      shippingPrice,
      total,
    } = req.body;

    if (
      !productId ||
      !serialNumber ||
      !productName ||
      !fullName ||
      !phoneNumber ||
      !address
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields.",
      });
    }

    const order = await Order.create({
      productId,
      serialNumber,
      productName,
      fullName,
      phoneNumber,
      address,
      quantity: Number(quantity || 1),
      subtotal: Number(subtotal || 0),
      shippingPrice: Number(shippingPrice || 0),
      total: Number(total || 0),
    });

    return res.status(201).json({
      success: true,
      message: "Order placed successfully.",
      data: order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to place order.",
      error: error.message,
    });
  }
};
 const getOrders = async (req, res) => {
  try {
    const { status } = req.query;

    const filter = {};
    if (status) filter.status = status;

    const orders = await Order.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders.",
      error: error.message,
    });
  }
};
 const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch order.",
      error: error.message,
    });
  }
};
 const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedOrder = await Order.findByIdAndDelete(id);

    if (!deletedOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Order deleted successfully.",
      data: deletedOrder,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete order.",
      error: error.message,
    });
  }
};
 const setOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value.",
      });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Order status updated successfully.",
      data: updatedOrder,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update order status.",
      error: error.message,
    });
  }
};

module.exports = { placeOrder, getOrders, getOrderById, deleteOrder, setOrderStatus }