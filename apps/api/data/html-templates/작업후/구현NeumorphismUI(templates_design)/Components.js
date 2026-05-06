// Password Toggle
function togglePassword() {
  const input = document.getElementById("password-input");
  const icon = document.getElementById("eye-icon");
  if (input.type === "password") {
    input.type = "text";
    icon.setAttribute("data-icon", "lucide:eye-off");
  } else {
    input.type = "password";
    icon.setAttribute("data-icon", "lucide:eye");
  }
}

// Checkbox Toggle
function toggleCheckbox(label) {
  const box = label.querySelector(".checkbox-box");
  const icon = label.querySelector(".check-icon");
  box.classList.toggle("checked");
  icon.classList.toggle("hidden");
}

// Radio Button
function selectRadio(label, groupName) {
  const allRadios = document.querySelectorAll(`[data-group="${groupName}"]`);
  allRadios.forEach((radio) => {
    radio.classList.remove("selected");
    radio.querySelector(".radio-dot").classList.add("hidden");
  });
  const radio = label.querySelector(".radio-box");
  radio.classList.add("selected");
  radio.querySelector(".radio-dot").classList.remove("hidden");
}

// Toggle Switch
function toggleSwitch(label) {
  const track = label.querySelector(".toggle-track");
  const thumb = label.querySelector(".toggle-thumb");
  const text = label.querySelector("span:last-child");

  if (track.classList.contains("active")) {
    track.classList.remove("active");
    track.style.background = "";
    thumb.style.right = "auto";
    thumb.style.left = "4px";
    text.textContent = "Off";
  } else {
    track.classList.add("active");
    track.style.background = "linear-gradient(145deg, #818cf8, #6366f1)";
    thumb.style.left = "auto";
    thumb.style.right = "4px";
    text.textContent = "On";
  }
}

// Range Slider Value
function updateRangeValue(slider) {
  document.getElementById("range-value").textContent = slider.value;
}

// Modal Functions
function openModal() {
  document.getElementById("modal").classList.remove("hidden");
  document.getElementById("modal").classList.add("flex");
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  document.getElementById("modal").classList.remove("flex");
}

// Close modal on background click
document.getElementById("modal").addEventListener("click", function (e) {
  if (e.target === this) {
    closeModal();
  }
});