document.getElementById("loginBtn").addEventListener("click", function () {
    let email = document.getElementById("email").value;
    let password = document.getElementById("password").value;

    if (email === "admin" && password === "1234") {
        window.location.href = "home.html";
    } else {
        alert("اسم المستخدم أو كلمة المرور غير صحيحة");
    }
});